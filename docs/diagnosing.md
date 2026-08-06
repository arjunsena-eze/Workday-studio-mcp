# Diagnosing Studio failures

Symptom-first lookup. Find your error text, get the real cause.

Studio's messages routinely name the symptom rather than the cause, and sometimes name the
wrong subsystem entirely. Every entry below is from a real failure. If your error is not
here, search `learnings.md` for a distinctive fragment of the literal text (via
`search_learnings` if your tool has MCP), then add what you find with `log_learning`.

---

## The method, in four steps

Worth internalising — it transfers to errors not yet in this file.

1. **Get the server log, not the UI message.** The Workday UI shows whatever your
   `cc:send-error` handler wrote. The log shows the cause, the actual payload contents, and
   the framework lines around it. `parse_server_log` summarises it, but note it does **not**
   surface `cc:log` / `cc:cloud-log` output — grep the raw file for your own log markers.
2. **Separate the wrapper from the cause.** Read the innermost `Caused by:` clause. Studio
   wraps transport failures in messages that name unrelated subsystems.
3. **Verify where the data actually is before theorising about it.** Log the payload and
   read it. Do not reason about what `parts[0]` "should" contain.
4. **Change one thing, redeploy, re-read.** Two simultaneous guesses make the result
   uninterpretable.

---

## Design-time: Studio rejects the file on open

### `cvc-complex-type.2.4.a: Invalid content was found starting with element 'X'. One of '{...}' is expected.`

**Cause:** child-order violation. Many Studio complex types are `xsd:sequence`, so order is
mandatory, not stylistic.

**The message is misleading.** It names the element it rejected and lists only the elements
still legal *at that position*. That reads as "X is unsupported" when X merely came too
late. Read the `One of {...}` list as "everything from here onward in the sequence" — if the
rejected element is absent from that list, it belongs **earlier**.

`cc:integration-system` order:

```
param → attribute-map-service → sequence-generator-service → transaction-log-service
→ delivery-service → retrieval-service → report-service → listener-service
→ custom-object-service → service-reference → data-initialization-service
```

**Caught by** `validate_assembly` → `SCHEMA_SEQUENCE_ORDER`.

---

### `String containing MVEL expression '...' is invalid. Closing and opening tags {...} do not match.`

**Cause:** Studio counts `{` and `}` in every value typed `MVELTemplateType` and rejects
unequal totals. That covers `cc:text`, `cc:header-text`, `cc:footer-text`, `cc:separator`
and ~135 attributes including `message`, `message-details`, `title`, `extra-path`,
`endpoint`, `value`.

Literal JSON braces are fine **only when they balance inside that one value**. The trap is
building a JSON envelope across two elements — opening brace in a `cc:header-text`, closing
brace in a later `cc:write`. Neither value balances alone.

**Fix:** build the string in `cc:expression`, which is `MVELExpressionType` and is **not**
brace-checked, then emit one balanced token:

```xml
<cc:eval id="Build">
  <cc:expression>props['out'] = '{"results": [' + props['rows'] + ']}'</cc:expression>
</cc:eval>
<cc:write id="Emit" output-mimetype="application/json">
  <cc:message><cc:text>@{props['out']}</cc:text></cc:message>
</cc:write>
```

**Caught by** `validate_assembly` → `MVEL_BRACE_IMBALANCE`.

---

### `scala.MatchError: org.eclipse.emf.ecore.impl.EObjectImpl@... (eProxyURI: ...assembly.xml#SomeId)`

**Cause:** `assembly-diagram.xml` references something that no longer resolves. Either a
stale `href` after a rename/delete, or a `cc:send-error` used as a diagram **node** with
coordinates or swimlane membership (it is not a renderable type).

**Fix:** every removed element needs all three diagram entries dropped —
`visualProperties`, every `connections` block naming it, and its swimlane `elements` line.
A rename needs all three updated. See `get_patterns topic="Diagram Rules"`.

Note: a bare `<visualProperties>` with **no** x/y wrapping a `cc:send-error` is what Studio
itself writes for the global error handler. Leave that alone.

---

### `cc:note is schema-invalid` / `cloud:launch-option>optional` schema error

`cc:note` is not valid inside `cc:assembly` — do not use it as a terminal marker.
`optional` is not a valid `cloud:launch-option` value; omit the element to make a param
optional. `as-of-effective-date` and friends are **date params only**.

---

## Runtime: the integration runs and fails

### `Trying to write END_DOCUMENT when document has no root (ie. trying to output empty document).`

**Cause:** something tried to serialise an XML document with no root — almost always
`cc:json-to-xml` receiving empty or non-JSON content.

**Most common reason:** you read the payload from the wrong place. For a
`cloud:listener-service`, the posted body is **not** in the message body and **not** in
`wd.retrieve.variable` at `StartHere`. At the entry point the message body holds Workday's
own `Get_Integration_Systems_Response` envelope. The payload is an event **document**:

```xml
<cc:local-out id="GetEventDocuments" routes-response-to="IterateDocs" endpoint="vm://wcc/GetEventDocuments">
  <cc:set name="ie.event.wid" value="lp.isSet() ? lp.getIntegrationEventWID() : null"/>
</cc:local-out>
<cc:route id="IterateDocs">
  <cc:doc-iterator/>                                <!-- omit labels: iterate ALL documents -->
  <cc:sub-route name="EachDocument" routes-to="Parse"/>
</cc:route>
<cc:async-mediation id="Parse" routes-to="Split">
  <cc:steps>
    <cc:copy id="LoadDoc" input="variable" input-variable="wd.retrieve.variable"/>
  </cc:steps>
</cc:async-mediation>
```

Also note `vars.isVariable()` tests **existence, not content**, so a ternary preferring the
variable takes the empty branch whenever it exists but is blank, and your fallback never
fires.

---

### `REST Method Type not set, defaulting to GET.` followed by `404 Not Found`

**Cause:** `cc:workday-out-rest` does not infer the verb from having a request body. Without
`method`, it issues a GET and discards the body. Against a collection endpoint a GET carries
no instance id, so the API answers `{"error":"not found: id","code":"S21"}`.

**Fix:** `method="POST"` (or PUT/PATCH/DELETE). The attribute is optional in the schema, so
nothing flags its absence — the only signal is that log line.

---

### `java.io.IOException: Unable to retrieve OAuth bearer token`

**This is a wrapper, not the cause.** `WorkdayOutRestTransport` wraps *any* non-2xx response
in this text regardless of what went wrong. Read the `Caused by:` clause for the real HTTP
status, resolved URL and response body. A wrong URL, wrong verb or wrong path all surface as
an apparent credential failure.

`cc:workday-out-rest` uses Workday's own injected credentials, so a genuine OAuth failure
there is rare. **Do not start auditing API clients or refresh tokens on the strength of this
message.**

---

### Request body posts with every field empty

**Cause:** xpath depth mismatch. `parts[0].xpath()` returns **empty string** on a
non-matching path rather than throwing, so the flow proceeds and the API error describes the
blank data instead of the bad path.

Most often `cc:json-to-xml` nesting: for an array of objects it applies **two** wrappers —
`nested-array-name` (default `entry`) names each element, then `nested-object-name` (default
`data`) wraps that element's object. So you split `/root/asset` but read fields at
`asset/data/field`.

**Fix:** log the converted XML immediately after `cc:json-to-xml` and read the real depth.

---

### `cc:xslt-plus` "Resource does not exist" after F5

Studio's resource cache. Close and reopen the project. See `get_patterns` → Common Errors.

---

## Process: the fix does not stick

### An error you already fixed reappears after deploy

**Cause:** Studio's open editor overwrote your on-disk edit. Eclipse does not re-read a file
while an editor is open on it, so Studio's next save serialises its stale in-memory model
over your change — silently, no conflict prompt.

**Tell-tale signs of a Studio round-trip:**

| Before (written externally) | After (Studio re-serialised) |
|---|---|
| `<![CDATA[...]]>` | `&quot;` entities |
| tab indentation | spaces, in Studio-owned regions |
| — | a `visualProperties` with no x/y for a top-level `cc:send-error` |

**Fix:** close the tab choosing *Don't Save* → F5 → edit → reopen → verify the change is
present → deploy.

---

### `validate_assembly` says clean but Studio rejects the file

Historically this meant the two schema-derived checks were missing; they are now in. If it
happens again, the model in `data/studio-schema-model.json` may be stale relative to your
Studio version — re-run `node bin/extract-schema-model.mjs` on a machine with Studio
installed and commit the result.

For anything the model cannot express, validate directly against the XSDs shipped in the
install at `plugins/com.workday.sh.common.ui_<version>/schemas/assembly/`. Two gotchas:
extract the `cc:assembly` **subtree** and validate that as a standalone document (the
`<beans>` root is Spring-namespaced and unschema'd, so validating the whole file performs
lax validation, skips everything and reports zero errors); and pass each schema's real
`targetNamespace` when loading the set. Control-test against a known-bad file before
trusting a clean result.
