import { z } from 'zod';

const REFERENCE = {
  'workday-in': {
    description: 'Entry point of the integration. Every assembly has exactly one. Defines launch parameters (cloud:param) and the integration system declarations that control which Workday services the integration can call.\n\nCORE DECLARATIONS inside cc:integration-system:\n- cloud:report-service: Declares one or more RAAS (Report as a Service) report aliases the integration calls. Required for any workday-out-rest call that uses intsys.reportService.getExtrapath(). See XML example for alias-only vs WID-bound forms.\n- cloud:retrieval-service: Registers the integration to access documents uploaded on the integration event. Pair with vm://wcc/GetEventDocuments. Self-closing, no children.\n- cloud:listener-service: Registers the integration as a webhook/event listener. Self-closing, no children. THE POSTED PAYLOAD IS NOT AVAILABLE AT StartHere. At the entry point wd.retrieve.variable does not exist yet and the message body holds framework state (a Get_Integration_Systems_Response envelope), NOT the posted body. The payload is stored as an event DOCUMENT and wd.retrieve.variable is the OUTPUT of retrieving it. Fetch it with: (1) cc:local-out to vm://wcc/GetEventDocuments setting ie.event.wid, (2) a cc:route whose strategy is a bare cc:doc-iterator (omit labels so every document is iterated) — this populates wd.retrieve.variable per document, (3) cc:copy input="variable" input-variable="wd.retrieve.variable" to load it into the message body. No cloud:retrieval-service declaration is needed. Reading parts[0] or wd.retrieve.variable directly at StartHere yields framework XML or an empty string, which surfaces downstream as the misleading "Trying to write END_DOCUMENT when document has no root".\n- cloud:attribute-map-service: Credentials and config stored outside the assembly (API keys, URLs, OAuth tokens). Read at runtime via intsys.getAttribute(\'Name\'). cloud:map inside it defines bidirectional value mappings looked up via intsys.integrationMapLookup() and intsys.integrationMapReverseLookup().\n- cloud:custom-object-service: Declares Workday custom objects accessed via workday-out-rest.\n- cloud:sequence-generator-service: For auto-increment IDs via lp.getSequencedValue().\n- cloud:param: Launch parameter prompts shown when launching the integration.\n\nACCESSING LAUNCH PARAMS IN XSLT:\n1. Declare cloud:param in cc:workday-in\n2. In the first cc:async-mediation cc:steps, add cc:eval BEFORE cc:xslt-plus\n3. In cc:eval: props[\'key\'] = lp.getSimpleData(\'Param Name\') for text, lp.getDate(\'Param Name\') for dates\n4. In the XSL: declare <xsl:param name="key"/> — Studio auto-passes all props as XSL params\n\ncloud:launch-option values:\n- "required" — valid on ALL param types (text, date, boolean, enumeration, class-report-field). Forces the user to fill it in before launching.\n- "as-of-effective-date" / "as-of-entry-datetime" / "begin-effective-date" / "begin-entry-datetime" — DATE params ONLY. Auto-populates the date from the business process context. Do NOT use these on non-date params — schema validation error (confirmed Mistake #2).\n- "optional" is NOT a valid value — causes schema error.',
    routes_via: 'routes-to',
    xml_example: `<!-- ASSEMBLY.XML -->
<cc:workday-in id="StartHere" routes-to="BuildRequest">
  <cc:integration-system name="INT999_My_Integration">

    <!-- Text param: leave blank at launch to skip; fill in to filter -->
    <cloud:param name="Employee_ID">
      <cloud:type><cloud:simple-type>text</cloud:simple-type></cloud:type>
    </cloud:param>

    <!-- Date param with launch-option (date params only) -->
    <cloud:param name="Effective Date">
      <cloud:type><cloud:simple-type>date</cloud:simple-type></cloud:type>
      <cloud:launch-option>as-of-effective-date</cloud:launch-option>
    </cloud:param>

    <!-- Attribute map: credentials and config stored outside the assembly.
         display-options: display-as-password (masks in UI), required-for-launch -->
    <cloud:attribute-map-service name="INT999_Attributes">
      <cloud:attribute name="Target API URL">
        <cloud:type><cloud:simple-type>text</cloud:simple-type></cloud:type>
        <cloud:display-option>required-for-launch</cloud:display-option>
      </cloud:attribute>
      <cloud:attribute name="API Secret">
        <cloud:type><cloud:simple-type>text</cloud:simple-type></cloud:type>
        <cloud:display-option>display-as-password</cloud:display-option>
        <cloud:display-option>required-for-launch</cloud:display-option>
      </cloud:attribute>
    </cloud:attribute-map-service>

    <!-- Worker / object picker param (WID reference). Read with lp.getReferenceData('Param Name', 'WID').
         The WID value in cloud:class-report-field is the Workday object type descriptor WID. -->
    <cloud:param name="Select Worker">
      <cloud:type>
        <cloud:class-report-field description="Worker" type="WID" singular="true">11111111aaaaaaaa22222222bbbbbbbb</cloud:class-report-field>
      </cloud:type>
    </cloud:param>

    <!-- Dropdown enumeration param. Read with lp.getSimpleData('Param Name'). Returns the selected string. -->
    <cloud:param name="Worker Type">
      <cloud:type>
        <cloud:enumeration-type name="EnumWorkerType">
          <cloud:enumeration>Contractor</cloud:enumeration>
          <cloud:enumeration>Consultant</cloud:enumeration>
          <cloud:enumeration>Board Member</cloud:enumeration>
        </cloud:enumeration-type>
      </cloud:type>
      <cloud:launch-option>required</cloud:launch-option>
    </cloud:param>

    <!-- Boolean param. Read with lp.getSimpleData() — returns 'true' or 'false' string. -->
    <cloud:param name="Needs Laptop">
      <cloud:type><cloud:simple-type>boolean</cloud:simple-type></cloud:type>
      <cloud:default/>
    </cloud:param>

    <!-- Sequencer service for auto-increment IDs. Read with lp.getSequencedValue() in cc:eval. -->
    <cloud:sequence-generator-service name="INT999_Seq_Service">
      <cloud:sequencer>INT999_Seq</cloud:sequencer>
    </cloud:sequence-generator-service>

    <!-- Custom object service for Workday custom objects. -->
    <cloud:custom-object-service name="INT999_CustomObj">
      <cloud:custom-object-alias description="IT Data Object" name="INT999_ITData">
        <cloud:custom-object-reference description="All IT Data" type="WID">33333333cccccccc44444444dddddddd</cloud:custom-object-reference>
      </cloud:custom-object-alias>
    </cloud:custom-object-service>

    <!-- Integration map service: defines bidirectional external↔internal value mappings.
         Looked up at runtime with intsys.integrationMapLookup() / integrationMapReverseLookup().
         cloud:internal-type and cloud:external-type define the value types on each side. -->
    <cloud:attribute-map-service name="INT999_ReferenceMaps">
      <cloud:map name="Ethnicity Type">
        <cloud:internal-type><cloud:simple-type>text</cloud:simple-type></cloud:internal-type>
        <cloud:external-type><cloud:simple-type>text</cloud:simple-type></cloud:external-type>
      </cloud:map>
      <cloud:map name="Job Category Location">
        <cloud:internal-type><cloud:simple-type>text</cloud:simple-type></cloud:internal-type>
        <cloud:external-type><cloud:simple-type>text</cloud:simple-type></cloud:external-type>
      </cloud:map>
    </cloud:attribute-map-service>

    <!-- RAAS (Report as a Service): declare all custom reports this integration calls.
         Two forms:
         (a) alias-only — Workday resolves by matching the alias to a report with the same name
         (b) WID-bound  — alias maps to a specific report WID, portable across report renames
         Confirmed across five production RAAS builds — ALL use cloud:report-service.
         Call the report with: intsys.reportService.getExtrapath('alias') in workday-out-rest extra-path. -->
    <cloud:report-service name="INT999_Reports">
      <cloud:report-alias description="Active workers with status fields" name="INT999_Get_Workers"/>
      <cloud:report-alias description="Location hierarchy with parent refs" name="INT999_Locations">
        <cloud:report-reference description="Location hierarchy with parent refs" type="WID">55555555eeeeeeee66666666ffffffff</cloud:report-reference>
      </cloud:report-alias>
    </cloud:report-service>

    <!-- Retrieval service: accesses files uploaded by the user on the integration event.
         Confirmed in production. Pair with vm://wcc/GetEventDocuments to fetch the files.
         Self-closing — no child elements. -->
    <cloud:retrieval-service name="INT999_Retrieval"/>

    <!-- Listener service: registers this integration as a webhook/event receiver.
         The posted payload is an event DOCUMENT — it is NOT in the message body and
         NOT in wd.retrieve.variable at StartHere. See the retrieval chain below.
         Self-closing — no child elements. -->
    <cloud:listener-service name="INT999_Listener_Service"/>
  </cc:integration-system>
</cc:workday-in>

<!-- ── Retrieving a listener payload (or any event document) ─────────────
  Required for cloud:listener-service. Reading parts[0] at StartHere returns
  Workday's Get_Integration_Systems_Response envelope, not the posted body. -->
<cc:local-out id="GetEventDocuments" routes-response-to="IterateDocs"
  endpoint="vm://wcc/GetEventDocuments">
  <cc:set name="ie.event.wid" value="lp.isSet() ? lp.getIntegrationEventWID() : null"/>
</cc:local-out>
<cc:route id="IterateDocs">
  <cc:doc-iterator/>                          <!-- omit labels: iterate ALL documents -->
  <cc:sub-route name="EachDocument" routes-to="ParsePayload"/>
</cc:route>
<cc:async-mediation id="ParsePayload" routes-to="NextStep">
  <cc:steps>
    <!-- Loads the document into the message body. Only now is it readable. -->
    <cc:copy id="LoadDoc" input="variable" input-variable="wd.retrieve.variable"/>
  </cc:steps>
</cc:async-mediation>

<!-- cc:eval captures launch params into props BEFORE the cc:xslt-plus.
     Studio then passes props as XSL stylesheet parameters automatically. -->
<cc:async-mediation id="BuildRequest" routes-to="NextStep">
  <cc:steps>
    <cc:eval id="CaptureParams">
      <cc:expression>props['Employee_ID'] = lp.getSimpleData('Employee_ID')</cc:expression>
      <cc:expression>props['Effective_Date'] = lp.getDate('Effective Date')</cc:expression>
    </cc:eval>
    <cc:xslt-plus id="MyXslt" output-mimetype="text/xml" url="MyTransform.xsl"/>
  </cc:steps>
</cc:async-mediation>

<!-- MyTransform.xsl — params match props keys exactly -->
<!--
  <xsl:param name="Employee_ID" select="''"/>
  <xsl:param name="Effective_Date" select="''"/>
-->`,
  },
  'transform': {
    description: 'Applies an XSLT stylesheet to the current message. Use for XML→XML transformations (e.g. building a Workday SOAP request from a report output).',
    routes_via: 'routes-to',
    xml_example: `<cc:transform id="BuildRequest" routes-to="NextStep">
  <cc:xslt href="BuildRequest.xsl"/>
</cc:transform>`,
  },
  'xslt-plus': {
    description: 'Like cc:transform but supports non-XML outputs (JSON, CSV, text) via output-mimetype. Used inside cc:async-mediation cc:steps.\n\nKEY RULES (confirmed from production integrations):\n1. cc:xslt-plus REQUIRES the current message to be valid XML. If you need to build JSON from props (not from incoming XML), write a <request/> stub first with cc:write, then apply cc:xslt-plus.\n2. All props map entries are automatically passed to the XSL as xsl:param values. Declare matching xsl:params in the stylesheet. STRING-TYPED PROPS ONLY: only props whose value is a real java.lang.String bind — object-typed props (LocalDate, Long, ...) bind as EMPTY xsl:params. The bug is masked because @{props[\'x\']} in cc:log renders the object\'s toString(), so logs look correct while the XSL sees blank. Even MVEL 1.3 x.toString() can retain non-String typing; the reliable coercion is props[\'y\'] = \'\' + props[\'x\'], then declare <xsl:param name="y"/>. Runtime-verified: a blank CSV column populated after switching to the coerced prop.\n3. xsl:param names CANNOT contain dots — dots are not valid XML NCName characters. Use underscores instead: DF_XRefCode not DF.XRefCode. Props keys can have dots (they are just strings in MVEL), but the xsl:param must use underscores.\n4. output-mimetype sets the Content-Type header automatically for subsequent cc:http-out calls.\n\nXSLT 3.0 STREAMING (confirmed INT_Studio_StarterKit 2025r1.02 — SSK129_StarterTemplate.xsl):\n\nStudio supports XSLT 3.0 with streaming for large payloads. Key patterns:\n\n1. STREAMING MODES:\n   <xsl:mode streamable="yes" on-no-match="shallow-skip"/>  — default streaming mode. Each node is processed once and discarded.\n   <xsl:mode name="in-memory" streamable="no" on-no-match="shallow-skip"/> — non-streaming mode for nodes already pulled into memory.\n   <xsl:mode name="replicate" streamable="yes" on-no-match="shallow-copy"/> — streaming copy mode.\n\n2. STREAM ROOT + READ CHILDREN ONE AT A TIME:\n   <xsl:apply-templates select="*/copy-of()" mode="in-memory"/>  — processes root element\'s children as in-memory nodes, one by one.\n\n3. xsl:ITERATE + xsl:NEXT-ITERATION for streaming loops with carried state (lookup data, counters):\n   <xsl:iterate select="wd:Report_Data/wd:Report_Entry">\n     <xsl:param name="lookupData1" as="document-node()*" select="()"/>\n     <!-- process one entry -->\n     <xsl:next-iteration><xsl:with-param name="lookupData1" select="$lookupData1"/></xsl:next-iteration>\n   </xsl:iterate>\n\n4. snapshot() — materializes the first document node as a fully in-memory document so xsl:key lookups work:\n   <xsl:param name="lookupData1" select="snapshot()" as="document-node()"/>  — use with xsl:key + key() function for O(1) lookups.\n\n5. xsl:TRY / xsl:CATCH for graceful error handling inside XSL:\n   <xsl:try><xsl:catch errors="*"><xsl:value-of select="$err:description"/></xsl:catch></xsl:try>\n   Available error variables: $err:module, $err:code, $err:description, $err:line-number.\n\n6. DYNAMIC LIBRARY INCLUDE with static param (read at XSL compile time from Studio props):\n   <xsl:param name="sskXsltLibMessage" static="yes"\n     select="ctx:getProperty(tube:getCurrentMediationContext(), \'sskXsltLibMessage\')"/>\n   <xsl:include _href="{$sskXsltLibMessage}"/>  — _href is evaluated at compile time using the static param value.\n   Required namespaces: xmlns:ctx="java:com.capeclear.esb.context.property.Context"\n                        xmlns:tube="java:com.capeclear.mediation.impl.tube.Tube"\n\n7. SSK STRUCTURED LOGGING via ssk:createMessage() (SSK112_FunctionLib_Messages.xsl):\n   The SSK ships a function library for structured CloudLog-compatible XML messages:\n   <xsl:value-of select="ssk:createMessage(\'INFO\', \'Worker processed\', $workerId)"/>\n   Returns: <lm><l>INFO</l><m>Worker processed</m><id>12345</id></lm>\n   Overloaded with 1–8 params: (level, message), (level, message, id), (level, message, id, detail), etc.\n   Required namespace: xmlns:ssk="urn:com.workday.custom.ssk.common"\n   Include: <xsl:include _href="{$sskXsltLibMessage}"/> (dynamic, loaded at compile time from Studio prop)',
    routes_via: 'routes-to (inline step inside cc:async-mediation)',
    xml_example: `<!-- Standard use: transform incoming XML to CSV or another XML -->
<cc:xslt-plus id="CsvXslt" output-mimetype="text/csv" url="WorkersToCsv.xsl"/>

<!-- Build JSON payload from props (not from incoming XML):
     cc:write provides a minimal valid XML input; the XSL ignores it and reads only xsl:params. -->
<cc:write id="PrepareInput">
  <cc:message><cc:text>&lt;request/&gt;</cc:text></cc:message>
</cc:write>
<cc:xslt-plus id="DayforceXslt" output-mimetype="application/json" url="WorkersToDayforce.xsl"/>

<!-- The matching XSL — note underscore param names (dots would fail at parse time): -->
<!--
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="text" encoding="UTF-8" omit-xml-declaration="yes"/>
  <xsl:param name="DF_XRefCode"  select="''"/>   <!-- props['DF_XRefCode'] -->
  <xsl:param name="DF_FirstName" select="''"/>   <!-- props['DF_FirstName'] -->
  <xsl:template match="/">
    { "EmployeeNumber": "<xsl:value-of select="$DF_XRefCode"/>", "FirstName": "<xsl:value-of select="$DF_FirstName"/>" }
  </xsl:template>
</xsl:stylesheet>
-->

<!-- ── XSLT 3.0 Streaming template skeleton (confirmed SSK129) ───────────
     For large Workday report payloads that cannot fit in memory.
     Requires Saxon-HE or a streaming-capable XSLT 3.0 processor. -->
<!--
<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="3.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:wd="urn:com.workday/bsvc"
  xmlns:ssk="urn:com.workday.custom.ssk.common"
  xmlns:ctx="java:com.capeclear.esb.context.property.Context"
  xmlns:tube="java:com.capeclear.mediation.impl.tube.Tube"
  expand-text="yes">

  <!-- ── Streaming modes ── -->
  <xsl:mode streamable="yes" on-no-match="shallow-skip"/>
  <xsl:mode name="in-memory" streamable="no" on-no-match="shallow-skip"/>

  <!-- ── Dynamic library include: loaded at XSL compile time from Studio prop ── -->
  <xsl:param name="sskXsltLibMessage" static="yes"
    select="ctx:getProperty(tube:getCurrentMediationContext(), 'sskXsltLibMessage')"/>
  <xsl:include _href="{$sskXsltLibMessage}"/>

  <!-- ── Props automatically passed as xsl:params by Studio ── -->
  <xsl:param name="Employee_ID"   select="''"/>
  <xsl:param name="sskIsDebugMode" select="'false'"/>

  <!-- ── Stream root: process each Report_Entry one at a time ── -->
  <xsl:template match="wd:Report_Data">
    <output>
      <!-- xsl:iterate carries state (e.g. lookup data) across entries without
           loading all entries into memory simultaneously -->
      <xsl:iterate select="wd:Report_Entry">
        <xsl:param name="rowNum" as="xs:integer" select="0"/>

        <xsl:try>
          <xsl:apply-templates select="copy-of()" mode="in-memory">
            <xsl:with-param name="rowNum" select="$rowNum"/>
          </xsl:apply-templates>
          <xsl:catch errors="*">
            <!-- $err:description, $err:code, $err:module available here -->
            <xsl:value-of select="ssk:createMessage('ERROR', $err:description, $Employee_ID)"/>
          </xsl:catch>
        </xsl:try>

        <xsl:next-iteration>
          <xsl:with-param name="rowNum" select="$rowNum + 1"/>
        </xsl:next-iteration>
      </xsl:iterate>
    </output>
  </xsl:template>

  <!-- ── In-memory template for one entry (already a copy-of() snapshot) ── -->
  <xsl:template match="wd:Report_Entry" mode="in-memory">
    <xsl:param name="rowNum" as="xs:integer" select="0"/>
    <row num="{$rowNum}">
      <xsl:value-of select="wd:Worker_ID"/>
    </row>
  </xsl:template>

</xsl:stylesheet>
-->

<!-- ── XSLT 3.0 with xsl:key lookup using snapshot() ───────────────────
     First param document is materialised in memory for O(1) key lookups.
     Remaining entries are streamed one at a time. -->
<!--
  <!-- The first document (lookup table) is materialised via snapshot() -->
  <xsl:param name="lookupData1" as="document-node()" select="snapshot()"/>
  <xsl:key name="lookupKey1" match="row" use="@id"/>

  <xsl:template match="wd:Report_Data">
    <xsl:iterate select="wd:Report_Entry">
      <xsl:variable name="id" select="wd:Worker_ID"/>
      <!-- O(1) keyed lookup in the snapshotted document -->
      <xsl:variable name="match" select="key('lookupKey1', $id, $lookupData1)"/>
      <xsl:if test="count($match) = 1">
        <mapped><xsl:value-of select="$match/@value"/></mapped>
      </xsl:if>
      <xsl:next-iteration/>
    </xsl:iterate>
  </xsl:template>
-->`,
  },
  'http-out': {
    description: 'Outbound HTTP/HTTPS call to an external REST API. The current message body is sent as the request body; the HTTP response becomes the new message. Supports GET, POST, PATCH, PUT, DELETE via http-method attribute. Basic auth via cc:http-basic-auth child element. Endpoint URL is a MVEL expression — build the full URL (including path + query string) in a preceding cc:eval step and store it in props.\n\nCRITICAL SCHEMA RULE (confirmed in production builds): cc:http-out MUST be a TOP-LEVEL element — place it directly inside <cc:assembly>, NEVER inside <cc:steps>. Studio\'s schema rejects it inside steps.\n\nCONFIRMED PATTERN (from a production build and INT_TEST_GetWorkers_CSV_STU):\n- Store credentials in cloud:attribute-map-service, read with intsys.getAttribute() in cc:eval\n- Build JSON payload with cc:xslt-plus (output-mimetype="application/json") — Content-Type is set automatically\n- For PATCH endpoints that include the entity ID in the path, build the full URL in cc:eval and store in props\n- Handle the response in a cc:async-mediation via routes-response-to (log it, write audit records, etc.)\n\nJSON PAYLOAD WITH XSLT TRICK: when building a JSON payload from props (not from incoming XML), write a minimal <request/> stub first so cc:xslt-plus has a valid XML input. The XSL declares xsl:params matching the prop keys — cc:xslt-plus passes all props as XSL parameters automatically. xsl:param names cannot contain dots; use underscores instead (DF_XRefCode not DF.XRefCode).',
    routes_via: 'routes-response-to',
    xml_example: `<!-- ASSEMBLY.XML: confirmed production + INT_TEST pattern -->

<!-- Step 1: capture credentials in cc:eval (at start of assembly, inside BuildRequest) -->
<cc:eval id="CaptureCredentials">
  <cc:expression>props['DF.API_URL']      = intsys.getAttribute('DayForce API Base URL')</cc:expression>
  <cc:expression>props['DF.API_UserName'] = intsys.getAttribute('DayForce API UserName')</cc:expression>
  <cc:expression>props['DF.API_Password'] = intsys.getAttribute('DayForce API Password')</cc:expression>
  <cc:expression>props['DF.Namespace']    = intsys.getAttribute('DayForce Client Namespace')</cc:expression>
</cc:eval>

<!-- Step 2 (later, after extracting entity key into props): build full URL -->
<cc:eval id="BuildPatchURL">
  <cc:expression>props['DF_XRefCode']    = parts[0].xpath('//wd:Worker[1]/wd:Worker_Data/wd:Worker_ID')</cc:expression>
  <!-- Full PATCH URL: base + path + query -->
  <cc:expression>props['DF.PATCH_URL']   = props['DF.API_URL'] + '/V1/employees/' + props['DF_XRefCode'] + '?clientNamespace=' + props['DF.Namespace']</cc:expression>
</cc:eval>

<!-- Step 3: build JSON payload using XSLT.
     cc:write produces <request/> so cc:xslt-plus has a valid XML input.
     The XSL ignores the input and reads xsl:params from props instead.  -->
<cc:async-mediation id="BuildPayload" routes-to="PostToDayforce" handle-downstream-errors="true">
  <cc:steps>
    <cc:write id="PrepareInput">
      <cc:message><cc:text>&lt;request/&gt;</cc:text></cc:message>
    </cc:write>
    <cc:xslt-plus id="DayforceXslt" output-mimetype="application/json" url="WorkersToDayforce.xsl"/>
  </cc:steps>
  <cc:send-error id="BuildPayloadError" rethrow-error="false" routes-to="PutIntegrationMessageDF"/>
</cc:async-mediation>

<!-- Step 4: PATCH call — endpoint and creds from props -->
<cc:http-out id="PostToDayforce" routes-response-to="HandleDayforceResponse"
  endpoint="@{props['DF.PATCH_URL']}" http-method="PATCH">
  <cc:http-basic-auth password="@{props['DF.API_Password']}" username="@{props['DF.API_UserName']}"/>
</cc:http-out>

<!-- Step 5: log the HTTP response -->
<cc:async-mediation id="HandleDayforceResponse">
  <cc:steps>
    <cc:log id="LogResponse">
      <cc:log-message>
        <cc:text>--- Dayforce PATCH Response ---</cc:text>
        <cc:line-separator/>
        <cc:message-content/>
        <cc:line-separator/>
        <cc:text>--- End Dayforce Response ---</cc:text>
      </cc:log-message>
    </cc:log>
  </cc:steps>
</cc:async-mediation>

<!-- WorkersToDayforce.xsl: reads from xsl:params (populated from props by cc:xslt-plus).
     Note: xsl:param names use underscores — dots are not valid in XML NCNames. -->
<!--
<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="text" encoding="UTF-8" omit-xml-declaration="yes"/>

  <xsl:param name="DF_XRefCode"  select="''"/>
  <xsl:param name="DF_FirstName" select="''"/>
  <xsl:param name="DF_LastName"  select="''"/>
  <xsl:param name="DF_JobTitle"  select="''"/>
  <xsl:param name="DF_WorkEmail" select="''"/>

  <xsl:template match="/">
{
  "EmployeeNumber": "<xsl:value-of select="$DF_XRefCode"/>",
  "FirstName":      "<xsl:value-of select="$DF_FirstName"/>",
  "LastName":       "<xsl:value-of select="$DF_LastName"/>",
  "JobTitle":       "<xsl:value-of select="$DF_JobTitle"/>",
  "BusinessEmail":  "<xsl:value-of select="$DF_WorkEmail"/>"
}
  </xsl:template>
</xsl:stylesheet>
-->

<!-- POST example (production pattern — payload comes directly from XML via xslt-plus) -->
<cc:http-out id="HttpOut" routes-response-to="HandleResponse"
  endpoint="@{props['DF.API_URL']}" http-method="POST">
  <cc:http-basic-auth password="@{props['DF.API_Password']}" username="@{props['DF.API_UserName']}"/>
</cc:http-out>`,
  },
  'workday-out-rest': {
    description: 'Calls a Workday REST endpoint — most commonly used for RAAS (Report as a Service) to fetch data FROM Workday. Also used for Workday REST custom object reads/writes.\n\nCRITICAL SCHEMA RULE (confirmed in production builds): cc:workday-out-rest MUST be a TOP-LEVEL element — place it directly inside <cc:assembly>, NEVER inside <cc:steps>. Studio\'s schema rejects it inside steps.\n\nRAAS INVOCATION (confirmed across five production builds — all use this pattern):\n- intsys.reportService.getExtrapath(\'alias\') resolves a cloud:report-alias to its report URL path at runtime. The alias must be registered in cloud:report-service in cc:workday-in.\n- Always use routes-response-to to chain to the next step after the report returns.\n\nFILTER PARAMETER SYNTAX:\n- Text param: ?Param_Name=@{props[\'value\']}\n- Object (WID) reference param: ?Worker!WID=@{props[\'workerWID\']} — the !WID suffix tells Workday this is an object reference, not a text value. Other types: !Organization_Reference_ID, !Position_ID, etc.\n- Multiple params: join with &amp; (not bare &)\n- No-filter: omit ? entirely\n\nRESPONSE STRUCTURE (confirmed from 5 integrations — both with and without format=simplexml):\n- Response root: wd:Report_Data\n- Records:       wd:Report_Data/wd:Report_Entry (one per row)\n- Fields inside each entry use wd: namespace: wd:Report_Entry/wd:Employee_ID\n- Reference type selection: wd:Report_Entry/wd:Org/wd:ID[@wd:type=&quot;WID&quot;]\n- format=simplexml: behavior is REPORT-DEPENDENT — do not assume. Some reports strip the wd: namespace prefix entirely (confirmed in one production report: XPath uses Report_Data/Report_Entry/Field with no wd:). Other reports keep wd: even with format=simplexml (confirmed in four other production reports). Always ask for a sample XML response before writing XPath — one row is enough to determine which applies. If wd: prefixes appear in the sample, use them. If absent, use unprefixed paths.\n\nSPLITTER CHOICE (critical):\n- Large datasets (>100 records): use xml-stream-splitter — streams one entry at a time, never loads full report into memory\n- Small datasets (<100 records): use xpath-splitter — loads all entries into memory, simpler but risky for large reports\n\nEMPTY REPORT HANDLING: if the report returns zero rows, the splitter routes to no sub-routes. Wrap the workday-out-rest routes-response-to target in a cc:async-mediation with a cc:send-error to handle the "no records" case.\n\nCUSTOM OBJECT READS/WRITES: extra-path can also target intsys.customObjectService.getExtrapath() for Workday custom objects.',
    routes_via: 'routes-response-to',
    xml_example: `<!-- ── Complete RAAS → split → per-record pattern (confirmed all 5 integrations) ──

DECLARATION in cc:workday-in (must exist before calling):
  <cloud:report-service name="INT145_Reports">
    <cloud:report-alias description="Active workers" name="INT145_Get_Workers"/>
  </cloud:report-service>
-->

<!-- 1. Fetch report — routes to splitter -->
<cc:workday-out-rest id="GetWorkers" routes-response-to="Splitter"
  extra-path="@{intsys.reportService.getExtrapath('INT145_Get_Workers')}?format=simplexml"/>

<!-- 2a. Large dataset (>100 records): xml-stream-splitter — streams one entry at a time -->
<cc:splitter id="Splitter">
  <cc:sub-route name="ProcessRecord" routes-to="ProcessRecord"/>
  <cc:xml-stream-splitter xpath="wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>

<!-- 2b. Small dataset (<100): xpath-splitter — loads all into memory -->
<cc:splitter id="Splitter">
  <cc:sub-route name="ProcessRecord" routes-to="ProcessRecord"/>
  <cc:xpath-splitter xpath="wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>

<!-- 3. Process each record — parts[0] is one wd:Report_Entry -->
<cc:async-mediation id="ProcessRecord" routes-to="WriteToTarget" handle-downstream-errors="true">
  <cc:steps>
    <cc:eval id="ExtractFields">
      <cc:expression>props['wid']      = parts[0].xpath('wd:Report_Entry/wd:Worker_WID')</cc:expression>
      <cc:expression>props['empID']    = parts[0].xpath('wd:Report_Entry/wd:Employee_ID')</cc:expression>
      <cc:expression>props['fullName'] = parts[0].xpath('wd:Report_Entry/wd:Full_Name')</cc:expression>
    </cc:eval>
  </cc:steps>
  <cc:send-error id="RecordError" rethrow-error="false" routes-to="PutRecordError"/>
</cc:async-mediation>

<!-- Filter by Worker WID (launch param from cloud:class-report-field picker) -->
<cc:workday-out-rest id="GetFilteredData" routes-response-to="Splitter2"
  extra-path="@{intsys.reportService.getExtrapath('INT999_Report')}?Worker!WID=@{props['Selected_Worker']}"/>

<!-- Multiple filter params — use &amp; between params -->
<cc:workday-out-rest id="GetManagerInfo" routes-response-to="ParseManager"
  extra-path="@{intsys.reportService.getExtrapath('INT999_Manager_Info')}?manager!WID=@{props['managerWID']}&amp;Supplier_Sup_Org!WID=@{props['supOrgWID']}"/>

<!-- Read a single record (no splitter needed when report always returns 1 row) -->
<cc:workday-out-rest id="GetRecord" routes-response-to="ParseRecord"
  extra-path="@{intsys.reportService.getExtrapath('INT999_Single_Record')}?Employee_ID=@{props['empID']}&amp;format=simplexml"/>
<cc:async-mediation id="ParseRecord" routes-to="NextStep">
  <cc:steps>
    <cc:eval id="Extract">
      <cc:expression>props['supOrgWID'] = parts[0].xpath('/wd:Report_Data/wd:Report_Entry/wd:Supervisory_Organization/wd:ID[@wd:type=&quot;WID&quot;]')</cc:expression>
    </cc:eval>
  </cc:steps>
</cc:async-mediation>`,
  },
  'local-out': {
    description: 'Sends the current message to a named endpoint (vm://) and optionally waits for a response. Two use patterns:\n\n1. BUILT-IN ENDPOINTS (Workday platform sinks):\n   - vm://wcc/PutIntegrationMessage — deliver a file or post an event message on the integration event\n   - vm://wcc/PagedGet — paginated SOAP fetching\n   - vm://wcc/GetEventDocuments — retrieve documents uploaded by the user on the integration event\n   - vm://wcc/StoreDocument — store a document to the integration deliverables list\n   Use cc:set children to pass named parameters (values are MVEL, strings need single quotes).\n\n2. SUB-FLOW DECOMPOSITION (confirmed pattern from INT_TEST_GetWorkers_CSV_STU):\n   Break a large assembly into named, independently readable sub-flows. Each sub-flow is a cc:local-in + its steps in the same assembly.xml file.\n   - Endpoint naming: vm://{IntegrationSystemName}/{LocalInId} — must match the integration-system name attribute exactly.\n   - routes-response-to PRESENT: the caller WAITS for the sub-flow to fully complete, then routes to the specified id. Use this for sequential chaining.\n   - routes-response-to ABSENT: fire-and-forget — caller fires the sub-flow but does NOT wait. Execution continues immediately on the main flow. Use only when the sub-flow result is not needed.\n   - props are SHARED across all sub-flows — values set before calling a sub-flow are readable inside it and vice versa.\n   - The message body is passed to the sub-flow unchanged; sub-flow can transform it. After sub-flow returns, message is whatever the sub-flow left it as.\n   - Diagram: each sub-flow gets its own named horizontal swimlane. Use nested VERTICAL swimlanes only for async-mediations with local send-errors.\n\nSEQUENTIAL CHAINING PATTERN: CallCSVFlow (routes-response-to=CallDayforceFlow) → CallDayforceFlow. After the CSV sub-flow finishes, execution automatically continues to CallDayforceFlow.\n\nPOST-SPLITTER CONTINUATION PATTERN: To wait for an entire splitter run to complete before proceeding, wrap the workday-out-rest + splitter inside a sub-flow. Set routes-response-to on the calling cc:local-out — it fires after ALL records are done.\n\nADDITIONAL ATTRIBUTES (confirmed in production):\n- unset-properties="false" — prevents the sub-flow from clearing properties set by the caller. Default behaviour may clear props not listed in cc:set; this flag preserves all caller props inside the sub-flow.\n- clone-request="true" — sends a copy of the message; the original message is not consumed. Use when delivering to PutIntegrationMessage while needing to continue processing the same content.\n- execute-when="MVEL_EXPR" — on the cc:local-out element itself (not just inside cc:steps). E.g. execute-when="context.isError() == true" fires the sub-flow only when an error occurred.\n\nDIAGRAM — vm:// DISPATCH IS NEVER DRAWN: do not add a <connections> block from Call_X (cc:local-out) to X (cc:local-in). The vm:// endpoint routes implicitly; Studio-authored diagrams draw arrows only for routes-to / routes-response-to. A hand-drawn dispatch connection renders as a redundant diagonal arrow across the canvas.',
    routes_via: 'routes-response-to (for sub-flow calls and built-in endpoints that return)',
    xml_example: `<!-- ── Sub-flow decomposition pattern (confirmed: INT_TEST_GetWorkers_CSV_STU) ──

  Main flow calls two sub-flows sequentially after CallGetWorkers:
  1. CSV sub-flow: transforms XML → CSV and delivers it
  2. Dayforce sub-flow: builds JSON payload from props, PATCHes Dayforce

  Props extracted before CallCSVFlow are available inside both sub-flows.
-->

<!-- Caller side: sequential chaining via routes-response-to -->
<cc:local-out id="CallCSVFlow" store-message="none"
  routes-response-to="CallDayforceFlow"
  endpoint="vm://INT_TEST_GetWorkers_CSV_STU/CSVFlow"/>

<cc:local-out id="CallDayforceFlow" store-message="none"
  endpoint="vm://INT_TEST_GetWorkers_CSV_STU/DayforceFlow"/>

<!-- Sub-flow entry points (cc:local-in) -->
<cc:local-in id="CSVFlow" routes-to="TransformToCSV"/>
<cc:local-in id="DayforceFlow" routes-to="BuildDayforcePayload"/>

<!-- ── Built-in endpoints ── -->

<!-- Deliver a file as a deliverable output on the integration event -->
<cc:local-out id="DeliverFile" store-message="none"
  endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.document.file.name"   value="'workers.csv'"/>
  <cc:set name="is.document.deliverable" value="'true'"/>
</cc:local-out>

<!-- Post an error message to the integration event -->
<cc:local-out id="DeliverError" store-message="none"
  endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.message.severity"     value="'CRITICAL'"/>
  <cc:set name="is.message.summary"      value="'Integration failed: ' + context.errorMessage"/>
  <cc:set name="is.document.deliverable" value="'false'"/>
</cc:local-out>

<!-- ── Additional attributes (confirmed in production) ──────────────────────────

unset-properties="false" — keep all caller props alive inside the sub-flow.
Without this, some props set by the caller may be cleared before the sub-flow runs. -->
<cc:local-out id="CallEmailFlow" store-message="none"
  endpoint="vm://INT999_Greenhouse_Hire_Inbound/Email_In"
  unset-properties="false">
  <cc:set name="Email_Failure_Reason" value="context.errorMessage"/>
</cc:local-out>

<!-- clone-request="true" — deliver a copy to PutIntegrationMessage while keeping
     the original message unchanged for continued processing in this flow. -->
<cc:local-out id="AttachDocument" store-message="none"
  endpoint="vm://wcc/PutIntegrationMessage"
  clone-request="true">
  <cc:set name="is.document.variable.name" value="'doc_variable_name'"/>
  <cc:set name="is.document.deliverable"   value="'true'"/>
</cc:local-out>

<!-- execute-when on the element itself — fire only on error (error notification pattern) -->
<cc:local-out id="NotifyOnError" store-message="none"
  execute-when="context.isError() == true"
  endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.message.severity" value="'ERROR'"/>
  <cc:set name="is.message.summary"  value="context.errorMessage"/>
</cc:local-out>

<!-- vm://wcc/GetEventDocuments — retrieve uploaded documents from the integration event.
     Pass ie.event.wid (integration event WID) to scope the request.
     routes-response-to handles the document list. -->
<cc:local-out id="GetDocs" routes-response-to="CheckFiles"
  endpoint="vm://wcc/GetEventDocuments">
  <cc:set name="ie.event.wid" value="lp.isSet() ? lp.getIntegrationEventWID() : null"/>
</cc:local-out>`,
  },
  'local-in': {
    description: 'Entry point for a named sub-flow within the same assembly. Paired with a cc:local-out that calls it via vm://{IntegrationSystemName}/{LocalInId}. The id of the cc:local-in must match the last segment of the vm:// endpoint on the calling cc:local-out.\n\nIn the diagram, each cc:local-in is the leftmost node in its own named horizontal swimlane, making each sub-flow independently navigable in Studio.\n\nATTRIBUTES:\n- access="public" — sub-flow is callable from other integrations (default). access="private" restricts to internal use only.\n- use-global-error-handlers="true" — connects this local-in to the assembly-level global error handlers. Without this, uncaught errors in the sub-flow bypass global handlers and may surface incorrectly.\n- icon="icons/iconName.png" — sets the icon displayed on this node in the Studio diagram.\n\nCHILD ELEMENTS — SSK typed parameter API contract (confirmed INT_Studio_StarterKit 2025r1.02):\n\ncc:parameter — declares a TYPED, documented input parameter that the caller must supply via cc:set on the calling cc:local-out. Unlike bare props (untyped string map), cc:parameter defines the type, documentation text, required flag, and a safe default expression. Attributes:\n  - name: the prop name the caller populates via cc:set (and this sub-flow reads from props)\n  - type: "string" | "boolean" | "number" | "xml" | "any"\n  - required="true" — sub-flow throws an error if the caller did not set this param\n  - default="MVEL_EXPR" — evaluated when the caller omits the param. Use context.containsProperty(\'name\') for null-safe guards (see eval entry for context.containsProperty vs props.containsKey).\n  Child text content is the human-readable documentation shown in Studio.\n\ncc:out-parameter — documents which props this sub-flow WRITES BACK to the shared props map after returning. This is documentation-only; it does not enforce the value. Callers read these after routes-response-to fires. Attributes:\n  - name: the prop key this sub-flow writes\n  - type: value type\n  Child text: documentation string.',
    routes_via: 'routes-to',
    xml_example: `<!-- ── Basic cc:local-in (simple sub-flow entry) ────────────────────────
     Naming rule: vm://IntegrationSystemName/LocalInId -->

<!-- Caller (main flow): -->
<cc:local-out id="CallCSVFlow" store-message="none"
  routes-response-to="CallDayforceFlow"
  endpoint="vm://INT_TEST_GetWorkers_CSV_STU/CSVFlow"/>

<!-- Entry point (start of CSV sub-flow swimlane): -->
<cc:local-in id="CSVFlow" routes-to="TransformToCSV"/>


<!-- ── SSK typed parameter API contract pattern ──────────────────────────
     Confirmed: INT_Studio_StarterKit 2025r1.02
     cc:parameter declares typed inputs; cc:out-parameter documents outputs.
     Caller passes values via cc:set children on the cc:local-out. -->

<cc:local-in id="CallSoap"
  access="public"
  use-global-error-handlers="true"
  icon="icons/callSoap.png"
  routes-to="BuildSoapRequest">

  <!-- Required typed input — caller MUST set this via cc:set -->
  <cc:parameter name="soapRequestXml" type="xml" required="true">
    The complete SOAP request XML envelope to send to Workday.
  </cc:parameter>

  <!-- Optional input with context.containsProperty() null-safe default -->
  <cc:parameter name="globalApiVersion" type="string"
    default="context.containsProperty('globalApiVersion') ? props['globalApiVersion'] : '43.0'">
    Workday API version string (e.g. 43.0). Defaults to 43.0 if not provided.
  </cc:parameter>

  <!-- Boolean flag with false default -->
  <cc:parameter name="sskIsDebugMode" type="boolean"
    default="context.containsProperty('sskIsDebugMode') ? props['sskIsDebugMode'] : false">
    When true, emits verbose CloudLog debug entries for each step.
  </cc:parameter>

  <!-- Documented outputs: what this sub-flow writes back to props -->
  <cc:out-parameter name="soapResponseXml" type="xml">
    The raw Workday SOAP response XML — available to caller after routes-response-to fires.
  </cc:out-parameter>
  <cc:out-parameter name="callStatus" type="string">
    "SUCCESS" or "FAULT" — set after the SOAP call completes or a SOAP fault is received.
  </cc:out-parameter>
</cc:local-in>

<!-- Caller side: supply typed params via cc:set children -->
<cc:local-out id="CallGetWorkers" store-message="none"
  routes-response-to="ProcessWorkerResponse"
  endpoint="vm://INT_SSK/CallSoap">
  <cc:set name="soapRequestXml"    value="message"/>
  <cc:set name="globalApiVersion"  value="'43.0'"/>
  <cc:set name="sskIsDebugMode"    value="props['Is_Debug']"/>
</cc:local-out>


<!-- ── Finally_* teardown pattern (confirmed INT_Studio_StarterKit) ───────
     Each SSK component has a paired Finally_ComponentName sub-flow called
     unconditionally after the component finishes — even on error.
     Pattern: call the component, then call its Finally_ to clean up. -->

<cc:local-out id="Call_Finally_CallSoap" store-message="none"
  endpoint="vm://INT_SSK/Finally_CallSoap"/>
<!-- Finally sub-flow handles logging completion, resetting component-scoped
     props, and signalling the parent flow that the component is done. -->`,
  },
  'async-mediation': {
    description: 'Passes the message asynchronously to the next step. Used to break synchronous call chains. Can contain nested cc:steps for inline processing.\n\nDIAGRAM RULE — one VERTICAL swimlane child per Do/PutError pair: each substantive async-mediation (Do{X}) plus its dedicated cc:local-out error handler (Put{X}Error) must occupy its OWN nested VERTICAL swimlane inside the sub-flow band, even when several pairs belong to the same sub-flow. The outer band lists one #//@swimlanes.N reference per pair. Add new vertical children at the END of the diagram swimlane list so existing indices do not shift. Sharing one vertical child between two pairs collapses them into a single box in Studio and loses the work-unit hierarchy. (Exception: error-BRANCH async-mediations without paired local-outs are deliberately co-located in one vertical band next to their decision point.)',
    routes_via: 'routes-to',
    xml_example: `<!-- Simple passthrough -->
<cc:async-mediation id="Async1" routes-to="NextStep"/>

<!-- With inline steps -->
<cc:async-mediation id="Async2" routes-to="NextStep">
  <cc:steps>
    <cc:eval id="SetProps">
      <cc:expression>props['key'] = message.xpath('//value')</cc:expression>
    </cc:eval>
  </cc:steps>
</cc:async-mediation>`,
  },
  'splitter': {
    description: 'Splits an XML, JSON, or delimited message into multiple sub-messages. Each sub-message is processed independently via cc:sub-route children.\n\nCRITICAL SCHEMA RULES (confirmed in production builds):\n- cc:splitter MUST be a TOP-LEVEL element — place it directly inside <cc:assembly>, NEVER inside <cc:steps>. Studio\'s schema rejects splitters nested in steps.\n- cc:splitter CANNOT have a routes-to attribute. Routing is done ONLY via cc:sub-route children. Attempting routes-to on the splitter itself causes a schema validation error.\n\nSPLITTER STRATEGY CHILDREN (choose one):\n- cc:xml-stream-splitter xpath="..."  — streams one node at a time; required for large datasets (>100 records). Never loads full payload into memory.\n- cc:xpath-splitter xpath="..."       — loads entire payload into memory first. Only for small datasets (<100 records).\n- cc:json-splitter json-path="..."    — for JSON arrays (e.g. from cc:http-out response).\n- cc:delimiter-splitter               — splits on a character delimiter.\n\nPOST-SPLITTER CONTINUATION PATTERN:\nTo continue processing after ALL records have been split, wrap the workday-out-rest + splitter inside a sub-flow called via cc:local-out. Set routes-response-to on the calling cc:local-out — that fires AFTER the entire splitter run finishes.\n\nno-split-message-error="false" — suppresses the error when the report returns zero records (good default for optional reports).\n\nDIAGRAM — SUB-ROUTE ARROW SOURCE (confirmed against a Studio-authored production diagram): the arrow from the splitter to each per-record target anchors at the SUB-ROUTE SLOT, not the splitter id. Use <source href="assembly.xml#//@beans/@mixed.1/@splitter.N/@subRoute.M"/> (both indices zero-based). An id-based source draws the arrow from the splitter box as a whole. Do NOT draw the vm:// dispatch arrow from a per-record cc:local-out to its cc:local-in — vm links are implicit and never drawn.',
    routes_via: 'cc:sub-route routes-to (per record). No routes-to on the splitter itself.',
    xml_example: `<!-- CRITICAL: cc:splitter is TOP-LEVEL (directly inside <cc:assembly>), never inside <cc:steps> -->
<!-- CRITICAL: no routes-to on cc:splitter — routing is via cc:sub-route only -->

<!-- Large dataset (>100 records): xml-stream-splitter -->
<cc:splitter id="SplitWorkers" no-split-message-error="false">
  <cc:sub-route name="ProcessRecord" routes-to="ProcessRecord"/>
  <cc:xml-stream-splitter xpath="wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>

<!-- Small dataset (<100 records): xpath-splitter -->
<cc:splitter id="SplitWorkers" no-split-message-error="false">
  <cc:sub-route name="ProcessRecord" routes-to="ProcessRecord"/>
  <cc:xpath-splitter xpath="wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>

<!-- Post-splitter continuation: wrap in sub-flow, use routes-response-to on the caller -->
<!-- The caller's routes-response-to fires after ALL records are processed -->
<cc:local-out id="CallGetAndSplit" store-message="none"
  routes-response-to="DeliverFile"
  endpoint="vm://INT145_MyInt/GetAndSplitFlow"/>

<cc:local-in id="GetAndSplitFlow" routes-to="GetWorkers"/>
<cc:workday-out-rest id="GetWorkers" routes-response-to="SplitWorkers"
  extra-path="@{intsys.reportService.getExtrapath('INT145_Get_Workers')}?format=simplexml"/>
<cc:splitter id="SplitWorkers" no-split-message-error="false">
  <cc:sub-route name="ProcessRecord" routes-to="ProcessRecord"/>
  <cc:xml-stream-splitter xpath="wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>`,
  },
  'decision': {
    description: 'Conditional routing. Evaluates conditions in order; the first matching route is taken. The last route (no condition) is the default/else branch.',
    routes_via: 'routes-to (on each cc:route)',
    xml_example: `<cc:decision id="CheckStatus">
  <cc:routes>
    <cc:route condition="message.xpath('//Status') = 'Active'" routes-to="ActiveBranch"/>
    <cc:route condition="message.xpath('//Status') = 'Terminated'" routes-to="TermBranch"/>
    <cc:route routes-to="DefaultBranch"/>
  </cc:routes>
</cc:decision>`,
  },
  'sub-assembly': {
    description: 'Delegates to another assembly file. Use for shared reusable flows packaged as a separate project.',
    routes_via: 'routes-to',
    xml_example: `<cc:sub-assembly id="CallShared" routes-to="NextStep"
  href="SharedAssembly.xml"/>`,
  },
  'note': {
    description: 'DO NOT USE cc:note anywhere in assembly.xml. The Studio schema rejects cc:note as a child of cc:assembly — confirmed from build experience (skeleton pattern).\n\nCORRECT TERMINAL PATTERN: an cc:async-mediation with NO routes-to attribute ends naturally. When execution reaches it and there is no routes-to, the sub-flow (or integration) terminates cleanly. No terminal stub element is needed.\n\nCRITICAL DIAGRAM RULE: cc:note also MUST NOT appear in assembly-diagram.xml. Studio\'s Factory.scala has no EditPart case for cc:note — adding it to <visualProperties>, swimlane <elements>, or <connections> crashes Studio with scala.MatchError at every load.\n\nSummary: cc:note is unsafe in both files. Use async-mediation with no routes-to as the terminal.',
    routes_via: 'none — do not use',
    xml_example: `<!-- WRONG — cc:note is schema-invalid in assembly.xml -->
<!-- <cc:note id="End"><cc:description>Done</cc:description></cc:note> -->

<!-- CORRECT terminal pattern: async-mediation with no routes-to ends naturally -->
<cc:async-mediation id="DoLastSubFlow" handle-downstream-errors="true">
  <cc:steps>
    <!-- real steps here -->
  </cc:steps>
  <cc:send-error id="LastSubFlowError" rethrow-error="false" routes-to="PutLastError"/>
</cc:async-mediation>
<!-- No routes-to = natural terminal. Sub-flow ends here. -->`,
  },
  'eval': {
    description: 'Executes MVEL expressions to set properties on the message. Used inside cc:async-mediation cc:steps blocks.\n\nKEY MVEL OBJECTS:\n- props: map of message properties. Values set here are automatically passed as XSL stylesheet parameters to any subsequent cc:xslt-plus in the same steps block.\n- lp: launch parameter accessor.\n  · lp.getSimpleData(\'Param Name\') — text/numeric/boolean/enumeration cloud:param. Returns String.\n  · lp.getDate(\'Param Name\') — date cloud:param. Returns formatted date string.\n  · lp.getReferenceData(\'Param Name\', \'WID\') — Worker/object picker param (cloud:class-report-field). Returns WID string.\n  · lp.getReferenceData(\'Param Name\', \'Employee_ID\') — same picker, different ID type. Multiple ID types can be tried.\n  · lp.getSequencedValue(\'Sequencer Name\', \'Sequence_ID\') — get next value from cloud:sequence-generator-service.\n  Null check pattern (always apply to getReferenceData): if(val==null||val==\'null\'||val==empty){val=\'\'}\n  Param Name must match the cloud:param name attribute exactly (spaces included).\n- parts[0].xpath(\'...\') — extract value from current message XML using XPath. Namespaces declared on assembly root are available.\n- context.errorMessage / context.getErrorMessage() — error message in send-error handlers.\n- intsys.getAttribute(\'Attr Name\') — reads a text integration attribute from cloud:attribute-map-service.\n- intsys.getAttributeReferenceData(\'Attr Name\', \'ID_Type\') — reads a reference-type integration attribute (cloud:class-report-field attribute).\n- util.currentDateTimeAsString() — current datetime as ISO string.\n- util.currentDateTimeAsString(\'PST\') — with timezone.\n- props[\'assembly.gateway.address\'] — gateway URL. Use .contains(\'impl\') to detect impl vs prod.\n- props[\'cc.customer.id\'] — the Workday tenant name.\n- props.containsKey(\'keyName\') — boolean check for prop existence in cc:eval expressions; use to guard initialization logic. NOTE: use context.containsProperty() instead of props.containsKey() inside cc:parameter default="..." attributes on cc:local-in — context.containsProperty correctly handles null-valued props that props.containsKey still returns true for.\n- context.containsProperty(\'propName\') — null-safe prop check for use inside cc:parameter default expressions. Returns false if the prop was never set OR if it was set to null. Pattern: default="context.containsProperty(\'key\') ? props[\'key\'] : \'fallback\'"\n- vars[\'varName\'] — read a variable by bracket notation.\n- vars[\'varName\'].getText() — get string content of a variable (e.g. base64-encoded value).\n- vars.isVariable(\'name\') — boolean; check existence before reading to avoid null dereference.\n- vars.setVariable(\'name\', value, \'text/plain\') — create/update a variable with explicit MIME type (three-argument form).\n\nINTEGRATION MAP LOOKUPS (cloud:attribute-map-service with cloud:map entries):\n- intsys.integrationMapLookup(\'Map Name\', externalValue) — forward lookup: external → Workday internal value.\n- intsys.integrationMapReverseLookup(\'Map Name\', internalValue) — reverse lookup: internal → external.\n- intsys.getAttributeAsBoolean(\'Attr Name\') — reads a boolean integration attribute (not string).\n\nDATE ARITHMETIC (Java Calendar — canonical pattern for all date math in Studio MVEL):\n```\nprops[\'hire_date_parsed\'] = new java.text.SimpleDateFormat("yyyy-MM-dd").parse(props[\'Hire_Date\'])\nprops[\'cal\'] = java.util.Calendar.getInstance()   // static factory, no "new"\nprops[\'cal\'].setTime(props[\'hire_date_parsed\'])\nprops[\'cal\'].add(java.util.Calendar.DATE, -1)    // subtract 1 day\nprops[\'contract_end\'] = new java.text.SimpleDateFormat("yyyy-MM-dd").format(props[\'cal\'].getTime())\n```\nAlso: `Math.round(props[\'Salary\'] * 12)` for numeric rounding.\n\nCONTEXT METHODS:\n- context.isError() — boolean; use in execute-when on cc:local-out to fire sub-flows only on error or only on success.\n- context.errorCode — the error code string (not just the message).\n\nMVEL TERNARY: props[\'x\'] = (condition) ? \'valueIfTrue\' : \'valueIfFalse\'\nMVEL COMMENTS: lines starting with // are ignored at runtime.\nexecute-when ATTRIBUTE: add execute-when="MVEL_EXPRESSION" on any step inside cc:steps to conditionally skip it at runtime. Also valid on cc:local-out and cc:workday-out-soap elements (not just cc:steps children).\n\nMVEL 1.3.13 GOTCHA — props[\'map\'].methodCall(complexExpr) FAILS inside if/else blocks (confirmed in a production audit build, April 2026):\nMVEL 1.3.13 cannot compile a method call on a map-accessed object when the argument is a complex expression AND the call is inside an if/else block. Manifests at deploy time as:\n  org.mvel.ParseException: unknown class: props[\'csv.builder\'].append(props[\'A\'] + \',\' + props[\'B\'])\n\nThree variants — only one fails:\n  ✓ props[\'map\'].methodCall(localVar) inside if/else — MVEL resolves localVar type fine\n  ✓ props[\'map\'].methodCall(complexExpr) at TOP level of cc:expression — works\n  ✗ props[\'map\'].methodCall(complexExpr) INSIDE an if/else block — fails to compile\n\nFIX: Replace the if/else with sequential cc:expression elements using ternary at top level. Pre-compute the variable parts into simple props, then call .method() at top level with simple concatenation.\n\nBAD:\n  <cc:expression>\n    if (condition) {\n      props[\'csv.builder\'].append(props[\'A\'] + \',\' + props[\'B\'] + \',label1\\n\')\n    } else {\n      props[\'csv.builder\'].append(props[\'A\'] + \',\' + props[\'B\'] + \',label2\\n\')\n    }\n  </cc:expression>\n\nGOOD — sequential expressions, ternary for branching, .append() at top level:\n  <cc:expression>props[\'_label\'] = condition ? \'label1\' : \'label2\'</cc:expression>\n  <cc:expression>props[\'csv.builder\'].append(props[\'A\'] + \',\' + props[\'B\'] + \',\' + props[\'_label\'] + \'\\n\')</cc:expression>\n\nKey insight: pre-compute branch results into simple props, then the method call becomes top-level with a simple concatenation argument.\n\nMVEL 1.3 GOTCHA — JAVA.TIME CONTEXT-SCOPE RULE (runtime-verified, June–July 2026):\nFully-qualified java.time static calls (java.time.LocalDate.parse(...), java.time.temporal.ChronoUnit.DAYS.between(...)) throw org.mvel.CompileException: unable to resolve property: java AT RUNTIME in any per-message eval (executed once per split record/message) — in ternary branches, in if-bodies, and even at expression top-level.\n- Bootstrap eval (the run-scoped Init/InitializeProperties eval, executed once per run before any splitter): java.time FQCN WORKS, even nested inside ternary branches and as method args — props[\'Current_Date\'] = (props[\'Tz\'] == null || props[\'Tz\'] == \'\') ? java.time.LocalDate.now() : java.time.LocalDate.now(java.time.ZoneId.of(props[\'Tz\']))\n- Per-message evals: NO java.time FQCN anywhere. Fix: store a LocalDate in props during the bootstrap eval, then use only INSTANCE methods plus ISO-string compareTo (YYYY-MM-DD strings compare chronologically; CDATA rules apply as usual for <):\n     props[\'CapFloorIso\'] = props[\'Current_Date\'].minusDays(props[\'MaxAgeDays\']).toString()\n     props[\'IsBefore\'] = (props[\'StartIso\'].compareTo(props[\'CapFloorIso\']) < 0) ? \'true\' : \'false\'\n- Build an arbitrary date from an ISO string without parse(): props[\'D\'] = props[\'Current_Date\'].withDayOfMonth(1).withYear(Integer.parseInt(props[\'Iso\'].substring(0,4))).withMonth(Integer.parseInt(props[\'Iso\'].substring(5,7))).withDayOfMonth(Integer.parseInt(props[\'Iso\'].substring(8,10))) — withDayOfMonth(1) first so intermediate year/month changes never hit an invalid day.\n- java.lang simple names (Integer, Long, Math) resolve fine per-message (production-verified). The java.text.SimpleDateFormat / java.util.Calendar patterns above remain valid per-message.\n- Offline MVEL compilation against Studio\'s mvel-1.3.13 jar PASSES on FQCNs (the failure is Studio\'s runtime class resolution), so compile-checks cannot catch it — grep per-message evals for "java." as a review step; validate_assembly flags this as JAVA_TIME_IN_PER_MESSAGE_EVAL (verified live: 7/7 split workers succeeded after removing the statics).\n\nMVEL 1.3.13 GOTCHA — a semicolon INSIDE a string literal fails the ENTIRE deploy (verified against Studio\'s own mvel-1.3.13-workday.12 jar, July 2026):\nStudio\'s bundled MVEL treats \';\' as a statement separator even inside single-quoted string literals. Any \';\' in a literal — leading, middle, or trailing (\'a; b\', \'; b\', \'b;\') — fails compilation of that expression with:\n  [Error: unterminated literal]\nand the whole assembly deploy dies at collection deploy. It looks like a data problem (every record failing) but is a static compile error. Parens and brackets inside strings are fine (\'a (b\', \' [Technical: x\' compile), and \';\' as a statement separator OUTSIDE literals is fine.\n\nBAD:  props[\'msg\'] = props[\'expected\'] + \'; found \' + props[\'actual\']\nGOOD: props[\'msg\'] = props[\'expected\'] + \' - found \' + props[\'actual\']\n\nvalidate_assembly flags this (MVEL_SEMICOLON_IN_STRING). Belt-and-braces before deploy: extract every cc:expression text / choose-route@expression / cc:set@value and compile each with org.mvel.MVEL.compileExpression() against Studio\'s own jar (plugins/com.workday.wtp.cloud.runtime.a_*/script/lib/mvel-1.3.13-workday.*.jar) — it reports the exact failing expression with [Near:] context. Blind spot: offline compile success does NOT clear fully-qualified java.* references — they compile offline but Studio\'s per-message runtime can fail to RESOLVE them (see the java.time gotcha above).',
    routes_via: 'none (inline step)',
    xml_example: `<!-- Capture launch params into props (before cc:xslt-plus) -->
<cc:eval id="CaptureParams">
  <cc:expression>props['Employee_ID'] = lp.getSimpleData('Employee_ID')</cc:expression>
  <cc:expression>props['Effective_Date'] = lp.getDate('Effective Date')</cc:expression>
  <cc:expression>props['Target_Org'] = lp.getSimpleData('Target_Org')</cc:expression>
  <cc:expression>props['Is_Impl'] = (props['assembly.gateway.address'].contains('impl') ? true : false)</cc:expression>
</cc:eval>

<!-- Read values from the current XML message (e.g. a report or API response) -->
<cc:eval id="ExtractFromMessage">
  <cc:expression>props['WorkerID'] = parts[0].xpath('wd:Report_Entry/wd:Worker_ID')</cc:expression>
  <cc:expression>props['Amount'] = parts[0].xpath('wd:Report_Entry/wd:Amount')</cc:expression>
</cc:eval>

<!-- Read an integration attribute -->
<cc:eval id="ReadAttribute">
  <cc:expression>props['TargetURL'] = intsys.getAttribute('Target API URL')</cc:expression>
</cc:eval>

<!-- Worker/object picker launch param (cloud:class-report-field type="WID") -->
<cc:eval id="CaptureWorkerRef">
  <cc:expression>props['Selected_Worker'] = lp.getReferenceData('Select Worker', 'WID')</cc:expression>
  <cc:expression>if (props['Selected_Worker'] == null || props['Selected_Worker'] == 'null') { props['Selected_Worker'] = '' }</cc:expression>
</cc:eval>

<!-- Detect impl vs prod + date util -->
<cc:eval id="DetectEnvironment">
  <cc:expression>props['Is_Impl']    = (props['assembly.gateway.address'].contains('impl') ? true : false)</cc:expression>
  <cc:expression>props['Tenant']     = props['cc.customer.id']</cc:expression>
  <cc:expression>props['Today']      = util.currentDateTimeAsString('PST').substring(0,10)</cc:expression>
</cc:eval>

<!-- Reference attribute (e.g. attribute whose type is a WID reference) -->
<cc:eval id="ReadRefAttribute">
  <cc:expression>props['EventSubcatWID'] = intsys.getAttributeReferenceData('Contract Type', 'Event_Classification_Subcategory_ID')</cc:expression>
</cc:eval>

<!-- Sequenced value (from cloud:sequence-generator-service) -->
<cc:eval id="GetSequence">
  <cc:expression>props['SeqID'] = lp.getSequencedValue('Integration_Sequencer_Name', 'INT999_Seq')</cc:expression>
</cc:eval>

<!-- MVEL ternary + null-safe rehire detection -->
<cc:eval id="CheckRehire">
  <cc:expression>props['WorkerWID']  = lp.getReferenceData('Select Worker', 'WID')</cc:expression>
  <cc:expression>if (props['WorkerWID'] == null || props['WorkerWID'] == 'null' || props['WorkerWID'] == empty) { props['WorkerWID'] = '' }</cc:expression>
  <cc:expression>props['Is_Rehire']  = (props['WorkerWID'] != '') ? 'Y' : 'N'</cc:expression>
</cc:eval>

<!-- execute-when: conditionally skip a step without an if/else branch -->
<!-- Add execute-when to any cc:steps child; evaluated as MVEL at runtime -->
<cc:xslt-plus execute-when="props['Is_Rehire'] == 'Y'" id="RehireXslt" url="Rehire.xsl" output-mimetype="text/xml"/>
<cc:write execute-when="props['Is_Rehire'] == 'N'" id="NewHireMsg">
  <cc:message><cc:text>No rehire record found</cc:text></cc:message>
</cc:write>

<!-- Integration map lookups (cloud:attribute-map-service with cloud:map) -->
<cc:eval id="MapValues">
  <!-- Forward lookup: external value (from Greenhouse) → internal Workday value -->
  <cc:expression>props['WD_EthnicityType'] = intsys.integrationMapLookup('Ethnicity Type', props['GH_Race'])</cc:expression>
  <!-- Reverse lookup: internal → external -->
  <cc:expression>props['GH_JobCategory'] = intsys.integrationMapReverseLookup('Job Category', props['WD_JobCategory'])</cc:expression>
  <!-- Boolean attribute -->
  <cc:expression>props['Full_Logging'] = intsys.getAttributeAsBoolean('Enable Full Logging')</cc:expression>
</cc:eval>

<!-- Date arithmetic (java.util.Calendar — only reliable date math in Studio) -->
<cc:eval id="CalcContractEndDate">
  <!-- Parse string → Date -->
  <cc:expression>props['hire_date_d'] = new java.text.SimpleDateFormat("yyyy-MM-dd").parse(props['Hire_Date'])</cc:expression>
  <!-- Calendar arithmetic: subtract 1 day -->
  <cc:expression>props['cal'] = java.util.Calendar.getInstance()</cc:expression>
  <cc:expression>props['cal'].setTime(props['hire_date_d'])</cc:expression>
  <cc:expression>props['cal'].add(java.util.Calendar.DATE, -1)</cc:expression>
  <!-- Format back to string -->
  <cc:expression>props['Contract_End_Date'] = new java.text.SimpleDateFormat("yyyy-MM-dd").format(props['cal'].getTime())</cc:expression>
  <!-- Numeric math -->
  <cc:expression>props['Annual_Salary'] = Math.round(props['Monthly_Salary'] * 12)</cc:expression>
</cc:eval>

<!-- context.isError() — fire sub-flow only on error or only on success -->
<!-- (Used on cc:local-out or any step, not just cc:eval) -->
<!-- execute-when="context.isError() == false"  → skip if error occurred -->
<!-- execute-when="context.isError() == true"   → run only when error occurred -->

<!-- vars API: save, check, read named variables -->
<cc:eval id="VarsPatterns">
  <!-- Check before reading to avoid null dereference -->
  <cc:expression>if (vars.isVariable('saved_xml')) { props['had_saved'] = 'Y' } else { props['had_saved'] = 'N' }</cc:expression>
  <!-- Read variable text content -->
  <cc:expression>props['encoded_key'] = vars['API_Key_Encoded'].getText()</cc:expression>
  <!-- Guard prop initialization -->
  <cc:expression>if (!props.containsKey('counter')) { props['counter'] = 0 }</cc:expression>
  <cc:expression>props['counter'] = props['counter'] + 1</cc:expression>
</cc:eval>`,
  },
  'workday-out-soap': {
    description: 'Calls a Workday SOAP web service. The current message body must already be a complete SOAP envelope (built by a preceding async-mediation + xslt or xslt-plus step). Specify the Workday application name and API version. The SOAP response becomes the new message and is routed via routes-response-to.\n\nCRITICAL: DO NOT use cc:workday-out-soap for RAAS (Report as a Service / custom reports). RAAS calls use cc:workday-out-rest + cloud:report-alias exclusively. SOAP-based report execution does not work with Workday custom reports and will cause incorrect diagram rendering. See the workday-out-rest entry.\n\nCURRENT API VERSION: v46.1 (2026R1, updated 2026-05-29). Use the lookup_soap_operations tool to list all operations available for a given service.\n\nVALID application VALUES (all 37 services from WWS v46.1 — source: community.workday.com/sites/default/files/file-hosting/productionapi/index.html):\n\nHCM CORE: Human_Resources, Staffing, Compensation, Talent, Performance_Management, Recruiting, Learning, Flex_Team, Adoption\nPAYROLL: Payroll, Payroll_Interface, Payroll_GBR, Payroll_AUS\nBENEFITS & TIME: Benefits_Administration, Benefits_Partner_Program_Integrations, Absence_Management, Time_Tracking\nFINANCE: Financial_Management, Revenue_Management, Cash_Management, Resource_Management, Inventory, Requests, Settlement_Services, Compensation_Review, Professional_Services_Automation\nACADEMIC (higher ed only): Academic_Foundation, Academic_Advising, Admissions, Student_Core, Student_Records, Student_Finance, Student_Transfer_Credit, Student_Recruiting\nPLATFORM: Integrations, Prism_Analytics, Workday_Connect, ACA_Partner_Integrations\n\nNOTE: "Payroll_Interface" is the correct name for payroll outbound file integrations — NOT "Payroll" (which is for payroll processing). "Benefits_Administration" not "Benefits".\n\nADDITIONAL ATTRIBUTES:\n- replace-with-soap-fault="true" — converts Workday SOAP error responses into SOAP Fault messages catchable by cc:send-error\n- execute-when="MVEL_EXPR" — conditionally skips the outbound call',
    routes_via: 'routes-response-to',
    xml_example: `<!-- Human Resources SOAP call (most common — Get_Workers, Hire_Employee, etc.) -->
<cc:workday-out-soap id="CallGetWorkers"
  routes-response-to="TransformResponse"
  application="Human_Resources"
  version="v46.1"/>

<!-- Staffing operations: Hire_Employee, Change_Job, End_Additional_Job, etc. -->
<cc:workday-out-soap id="HireEmployee"
  routes-response-to="HandleHireResponse"
  application="Staffing"
  version="v46.1"
  replace-with-soap-fault="true"/>

<!-- Payroll Interface — for outbound payroll file integrations -->
<cc:workday-out-soap id="GetPayResults"
  routes-response-to="HandlePayResults"
  application="Payroll_Interface"
  version="v46.1"/>

<!-- Benefits Administration -->
<cc:workday-out-soap id="ChangeBenefits"
  routes-response-to="HandleBenefitsResponse"
  application="Benefits_Administration"
  version="v46.1"/>

<!-- execute-when: skip when a condition is false -->
<cc:workday-out-soap id="ConvertCW"
  execute-when="props['Contingent_Worker_ID'] != ''"
  routes-response-to="HandleConvertResponse"
  application="Staffing"
  version="v46.1"/>

<!-- Full valid application list (WWS v46.1 / 2026R1):
  HCM:      Human_Resources, Staffing, Compensation, Talent,
            Performance_Management, Recruiting, Learning, Flex_Team, Adoption
  Payroll:  Payroll, Payroll_Interface, Payroll_GBR, Payroll_AUS
  Benefits: Benefits_Administration, Benefits_Partner_Program_Integrations
  Time:     Absence_Management, Time_Tracking
  Finance:  Financial_Management, Revenue_Management, Cash_Management,
            Resource_Management, Inventory, Requests, Settlement_Services,
            Compensation_Review, Professional_Services_Automation
  Academic: Academic_Foundation, Academic_Advising, Admissions, Student_Core,
            Student_Records, Student_Finance, Student_Transfer_Credit, Student_Recruiting
  Platform: Integrations, Prism_Analytics, Workday_Connect, ACA_Partner_Integrations
-->`,
  },
  'send-error': {
    description: 'Error handler that processes errors using standard assembly components. Routes to a step (typically a PutIntegrationMessage local-out) for structured error reporting. Use as a global handler on the assembly or a local handler inside a mediation component. Set rethrow-error="true" to pass the error upstream after handling.\n\nBEST PRACTICE — per-handler delivery: give each local send-error its own cc:local-out with a step-specific error message (routes-to="StepNameError"). Use a shared DeliverError only for the GlobalErrorHandler. This allows distinct summaries per failure point.\n\nDIAGRAM RULES — violations crash Studio with scala.MatchError:\n1. NEVER reference cc:send-error by XML id anywhere in the diagram. Always use EMF XPath.\n2. Assembly-level cc:send-error (GlobalErrorHandler): use empty <visualProperties> (no x/y), include in swimlane <elements> via EMF XPath, and add a <connections> entry. No closed="true" needed.\n3. Local cc:send-error inside cc:async-mediation: add ONLY a <connections> entry with EMF XPath source — Studio renders it inside the parent box. Never add to visualProperties or swimlane elements.\n4. EMF XPath (@mixed index) counts ALL child nodes: whitespace text nodes (nodeType=3), element nodes (nodeType=1), AND XML comment nodes (nodeType=8). Use python3 xml.dom.minidom to count precisely.\n5. PREDICTABILITY RULE: if you write assembly.xml with NO XML comments, all element nodes fall on odd indices (1, 3, 5, 7...) because whitespace text nodes fill the even slots. This makes indices trivially calculable without running Python: the element at 0-based position k among cc:assembly\'s direct child elements is @mixed.(2k+1) — e.g. the 10th top-level element (k=9) is @mixed.19; the nested send-error that follows cc:steps inside an async-mediation is k=1 → /@mixed.3 (verified: a computed ref rendered a GlobalErrorHandler correctly in Studio, swimlane placement and routesTo connection included). Adding even one comment breaks this regularity — run the Python counter whenever comments are present.\n6. STUDIO AUTO-CORRECTS @mixed INDICES — DO NOT HAND-EDIT AFTER STUDIO WRITES: When Studio serializes the diagram (after the user moves nodes, adds steps, or reorganizes swimlanes), it recalculates all @mixed.N indices itself. The result is always correct. Do NOT re-run the Python counter or manually update source href values after Studio has touched the file — Studio\'s output supersedes any hand-computed values. (Confirmed in production: GlobalErrorHandler shifted from @mixed.69 to @mixed.95 after a 12-element insertion; Studio auto-corrected all connection source references when the user reorganized.)\n\nDIAGRAM ERROR PLACEMENT (confirmed production GetManager pattern, April 2026):\n- Do NOT isolate error-branch nodes in a separate "Errors" outer band. Co-locate each error branch adjacent to its decision point inside the same VERTICAL inner band. This eliminates long cross-band arrows and is the pattern Studio itself uses when it auto-generates connections.\n- Nesting 3 levels of VERTICAL bands is acceptable for complex sub-flows (outer band → VERTICAL container → inner band).\n- Error mediations (AsyncMediation_XxxNotFound, AsyncMediation_XxxError) go in the same VERTICAL band as the step that generates them — stacked vertically below the happy-path node.',
    routes_via: 'routes-to',
    xml_example: `<!-- ASSEMBLY.XML: per-handler delivery pattern (recommended) -->
<cc:async-mediation id="BuildRequest" routes-to="CallNext" handle-downstream-errors="true">
  <cc:steps>
    <cc:xslt-plus id="MyXslt" output-mimetype="text/xml" url="Build.xsl"/>
  </cc:steps>
  <!-- Routes to its own delivery step, not shared DeliverError -->
  <cc:send-error id="BuildRequestError" rethrow-error="false" routes-to="BuildRequestFailed"/>
</cc:async-mediation>

<!-- Per-handler delivery: step-specific error message -->
<cc:local-out id="BuildRequestFailed" store-message="none"
  endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.message.severity"   value="'ERROR'"/>
  <cc:set name="is.message.summary"    value="'Error building SOAP request'"/>
  <cc:set name="is.message.detail"     value="context.errorMessage"/>
  <cc:set name="is.document.deliverable" value="'false'"/>
</cc:local-out>

<!-- Global catch-all — routes to shared DeliverError -->
<cc:send-error id="GlobalErrorHandler" routes-to="DeliverError" rethrow-error="false"/>

<cc:local-out id="DeliverError" store-message="none"
  endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.message.severity"   value="'CRITICAL'"/>
  <cc:set name="is.message.summary"    value="'Integration failed: ' + context.errorMessage"/>
  <cc:set name="is.document.deliverable" value="'false'"/>
</cc:local-out>

<!-- ASSEMBLY-DIAGRAM.XML: confirmed safe patterns from Studio serialization.

     GlobalErrorHandler — 3 required entries (all EMF XPath, never XML id):
       1. Empty <visualProperties> (no x/y = auto-positioned by Studio)
       2. <connections> source entry
       3. <swimlane> <elements> entry

     Local send-error — 1 entry only:
       <connections> source entry only. Never in visualProperties or swimlane elements.

     Index calculation: count ALL child nodes after <cc:assembly> (0-based):
       text nodes (nodeType=3), element nodes (nodeType=1), comment nodes (nodeType=8).
     Use python3:
       import xml.dom.minidom
       doc = xml.dom.minidom.parse('assembly.xml')
       asm = doc.getElementsByTagNameNS('*','assembly')[0]
       for i,n in enumerate(asm.childNodes):
           print(i, n.nodeType, getattr(n,'tagName','[text/comment]'))
     The local send-error inside an async-mediation is always @mixed.3 of its parent.
-->

<!-- GlobalErrorHandler (assume @mixed.N is the correct index for your file) -->
<visualProperties>
  <element href="assembly.xml#//@beans/@mixed.1/@mixed.N"/>
</visualProperties>
<connections type="routesTo">
  <source href="assembly.xml#//@beans/@mixed.1/@mixed.N"/>
  <target href="assembly.xml#DeliverError"/>
</connections>

<!-- Local send-error — connections only, no visualProperties -->
<connections type="routesTo">
  <source href="assembly.xml#//@beans/@mixed.1/@mixed.7/@mixed.3"/>
  <target href="assembly.xml#BuildRequestFailed"/>
</connections>

<!-- Swimlanes: GlobalErrorHandler in Error Handler lane via EMF XPath (no closed="true") -->
<swimlanes x="30" y="30" name="Error Handler" alignment="END" labelAlignment="LEFT">
  <elements href="assembly.xml#//@beans/@mixed.1/@mixed.N"/>
  <elements href="assembly.xml#DeliverError"/>
</swimlanes>`,
  },
  'log-error': {
    description: 'Error handler that logs the current error (message + Java stack trace) to the Studio output log. Use when you want diagnostic data in the log without exposing individual errors on the integration event. Avoid logging large messages — they can be truncated. Set rethrow-error="true" to also propagate to the next upstream handler. IMPORTANT: NOT renderable in assembly-diagram.xml — do not add to visualProperties or swimlane elements.',
    routes_via: 'none (terminal error handler)',
    xml_example: `<!-- Simplest global error handler: just log it -->
<cc:log-error id="GlobalErrorHandler" level="error" rethrow-error="false"/>

<!-- Local error handler inside async-mediation, then rethrow -->
<cc:async-mediation id="ProcessData" routes-to="NextStep"
  handle-downstream-errors="true">
  <cc:error-handlers>
    <cc:log-error id="LocalLog" level="warn" rethrow-error="true"/>
  </cc:error-handlers>
  <cc:steps>
    <!-- ... -->
  </cc:steps>
</cc:async-mediation>

<!-- Valid log levels: debug, info, warn, error, fatal -->`,
  },
  'xml-to-csv': {
    description: 'Streams an XML document to CSV format with a low memory footprint. The XML structure must have a repeating row element whose sequential child elements map to CSV columns. Set writeHeaderLine="true" to emit column names on the first line. Use format="rfc4180" for standards-compliant quoting; "simple" (default) also accepts apostrophe quotes and trims whitespace.',
    routes_via: 'routes-to (inline step inside async-mediation)',
    xml_example: `<!-- Inside cc:async-mediation cc:steps block -->
<cc:xml-to-csv id="ConvertToCsv"
  separator=","
  line-separator="LF"
  writeHeaderLine="true"
  format="rfc4180"/>

<!-- With explicit input/output locations (default: rootpart → rootpart) -->
<cc:xml-to-csv id="ConvertToCsv"
  input="rootpart"
  output="rootpart"
  separator=","
  line-separator="LF"
  writeHeaderLine="true"
  format="rfc4180"/>`,
  },
  'csv-to-xml': {
    description: 'Streams a CSV document to XML format. Use useFirstLineAsHeader="true" to derive column names from the header row, or supply colNames as a comma-separated list. Specify rootName and rowName for the output XML element names. Use format="rfc4180" for standards-compliant input parsing.',
    routes_via: 'routes-to (inline step inside async-mediation)',
    xml_example: `<!-- Inside cc:async-mediation cc:steps block -->
<cc:csv-to-xml id="ParseCsv"
  separator=","
  useFirstLineAsHeader="true"
  rootName="Workers"
  rowName="Worker"
  format="rfc4180"/>

<!-- With explicit column names instead of header row -->
<cc:csv-to-xml id="ParseCsv"
  separator=","
  colNames="Employee_ID,First_Name,Last_Name,Job_Title"
  rootName="Workers"
  rowName="Worker"/>`,
  },
  'xml-stream-splitter': {
    description: 'Streaming splitter for large XML documents — processes records one at a time without loading the entire document into memory. Critical for large Workday reports (thousands of rows). Used as the strategy child inside cc:splitter, alongside a cc:sub-route pointing to the step that processes each record.\n\nKEY DIFFERENCE FROM cc:xpath-splitter: cc:xpath-splitter loads the full document into memory and OOMs on large reports. cc:xml-stream-splitter streams records — prefer it for any report with > a few hundred rows. It is the dominant pattern across production integrations.\n\nPattern: cc:splitter (container) → cc:sub-route (per-record route) + cc:xml-stream-splitter (streaming strategy). The sub-route chains into per-record async processing. Use cc:aggregator downstream to recombine results.\n\nno-split-message-error="true" throws an error if the document has zero matching records.',
    routes_via: 'sub-route routes-to (per record); parent cc:splitter routes-to (after all records complete)',
    xml_example: `<!-- cc:splitter is the container — cc:xml-stream-splitter is the strategy inside it. -->

<!-- Workday report split by Report_Entry (Workday namespace required) -->
<cc:splitter id="SplitWorkers">
  <cc:sub-route name="SubRoute" routes-to="ProcessWorker"/>
  <cc:xml-stream-splitter xpath="/wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>

<!-- CSV rows from cc:csv-to-xml output (no namespace needed) -->
<cc:splitter id="SplitCsvRows">
  <cc:sub-route name="SubRoute" routes-to="ProcessRow"/>
  <cc:xml-stream-splitter xpath="root/row"/>
</cc:splitter>

<!-- In-memory alternative (small docs only — loads all into memory): -->
<cc:splitter id="SplitSmall" no-split-message-error="false">
  <cc:sub-route name="SubRoute" routes-to="ProcessItem"/>
  <cc:xpath-splitter xpath="wd:Report_Data/wd:Report_Entry"/>
</cc:splitter>`,
  },
  'copy': {
    description: 'Copies or restores the current message. Five use patterns:\n\n1. SAVE TO VARIABLE: output="variable" + output-variable="varName" — saves current message into a named variable. Useful for preserving XML before it gets transformed.\n\n2. RESTORE FROM VARIABLE: input="variable" + input-variable="varName" — loads a previously saved variable back as the current message.\n\n3. RETYPE MESSAGE: output-mimetype="text/plain" + input="variable" + input-variable="varName" — reads from a variable and re-types the content (useful when a stored doc was retrieved with wrong Content-Type).\n\n4. PLAIN COPY: no attributes — passes the current message through. Used structurally before cc:aggregator.\n\n5. APPEND TO XML VARIABLE: output="variable" + output-variable + append-to-output-element="true" + output-xpath="/root" — appends the current message as a child of the specified XPath node inside the output variable, instead of overwriting. Confirmed in production: used to build an XML log file incrementally across iterations.',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps)',
    xml_example: `<!-- Save current message to a variable (before transforming it) -->
<cc:copy id="SaveWorkerXml" output="variable" output-variable="Worker_Split" input="message"/>

<!-- Restore the variable back to the current message later -->
<cc:copy id="RestoreWorkerXml" input="variable" input-variable="Worker_Split"/>

<!-- Retype a stored variable (e.g. doc retrieved as bytes, cast to text) -->
<cc:copy id="CastToText" output-mimetype="text/plain" input="variable" input-variable="wd.retrieve.variable"/>

<!-- Save aggregated output to variable before persisting -->
<cc:copy id="SaveCsv" output="variable" output-variable="csv"/>

<!-- Restore aggregated output from variable to current message -->
<cc:copy id="RestoreCsv" output="message"/>

<!-- Plain copy — passes message through (structural step before aggregator) -->
<cc:copy id="Copy"/>

<!-- Append to XML variable — build an XML log file incrementally.
  Each call appends the current message as a child of /message_log in the variable. -->
<cc:copy id="AppendLogEntry"
  output="variable" output-mimetype="text/xml" output-variable="audit_log"
  input="variable" input-variable="this_log_entry"
  append-to-output-element="true"
  output-xpath="/message_log"/>`,
  },
  'route': {
    description: 'Conditional or loop routing with three strategy variants:\n\n1. cc:loop-strategy — repeats the sub-route until the condition MVEL expression evaluates false. Use for pagination loops (fetch pages until all records are retrieved). Set increment to advance the offset counter after each iteration. Loop also exits immediately when a downstream step sets props[\'loop_break\'] = true.\n\n2. cc:mvel-strategy + cc:choose-route — evaluates MVEL expressions in order; takes the first sub-route whose expression is true. Works like if/else-if/else. Use expression="true" as the last cc:choose-route for a default branch.\n\n3. cc:doc-iterator — iterates over uploaded documents (attachments on the integration event). Each document becomes the current message in the sub-route.\n\nAll routes must have matching cc:sub-route elements with name attributes that match the route/choose-route names exactly.',
    routes_via: 'sub-route routes-to (for each branch)',
    xml_example: `<!-- ── Pagination loop (cc:loop-strategy) ─────────────────────────────────
  Repeats sub-route until condition = false or props['loop_break'] = true.
  increment is evaluated after each sub-route call completes.
  Common init before the route: props['offset'] = 0, props['response_count'] = very_large -->
<cc:route id="PagedFetch">
  <cc:loop-strategy
    condition="props['offset'] &lt;= props['response_count']"
    increment="props['offset'] = props['offset'] + 6000"/>
  <cc:sub-route name="SubRoute" routes-to="FetchOneBatch"/>
</cc:route>
<!-- FetchOneBatch sets props['loop_break'] = true when the last page is empty -->

<!-- Loop without increment — terminates when downstream changes stop condition -->
<cc:route id="ActivityLoop">
  <cc:loop-strategy condition="props['data_count'] != 0"/>
  <cc:sub-route name="SubRoute" routes-to="FetchActivityBatch"/>
</cc:route>

<!-- ── Conditional routing (cc:mvel-strategy + cc:choose-route) ────────────
  First expression that evaluates true takes that sub-route.
  Use expression="true" as the default/else branch (must be last). -->
<cc:route id="HireType">
  <cc:mvel-strategy>
    <cc:choose-route expression="props['Is_Rehire'] == 'Y'" route="Rehire"/>
    <cc:choose-route expression="props['Is_Rehire'] == 'N'" route="New Hire"/>
  </cc:mvel-strategy>
  <cc:sub-route name="New Hire" routes-to="NewHireFlow"/>
  <cc:sub-route name="Rehire"   routes-to="RehireFlow"/>
</cc:route>

<!-- Three-way branch (expression="true" = default else) -->
<cc:route id="CheckManagerOrgs">
  <cc:mvel-strategy>
    <cc:choose-route expression="props['Sup_Org'] == ''"  route="Manager - No Sup Org"/>
    <cc:choose-route expression="props['Sup_Org'] != ''"  route="Manager - Active Sup Org"/>
    <cc:choose-route expression="true"                    route="Manager - Inactive Sup Org"/>
  </cc:mvel-strategy>
  <cc:sub-route name="Manager - Active Sup Org"   routes-to="ActiveOrgFlow"/>
  <cc:sub-route name="Manager - No Sup Org"       routes-to="NoOrgFlow"/>
  <cc:sub-route name="Manager - Inactive Sup Org" routes-to="InactiveOrgFlow"/>
</cc:route>

<!-- ── Document iteration (cc:doc-iterator) ──────────────────────────────
  Iterates over uploaded documents on the integration event.
  Each document becomes the current message for one pass of the sub-route. -->
<cc:route id="DocIterator">
  <cc:doc-iterator/>
  <cc:sub-route name="ProcessFile" routes-to="ProcessDocument"/>
</cc:route>`,
  },
  'set-headers': {
    description: 'Sets HTTP headers on the current message before a cc:http-out call. Three child elements work together:\n\n- cc:remove-headers (empty) — clears ALL existing headers. Always include first to prevent stale headers from a previous response leaking into the next request.\n- cc:add-headers — container for cc:add-header children.\n- cc:add-header name="..." value="..." — adds one header. Values support @{} MVEL interpolation.\n\nFULL OAUTH2 TOKEN REFRESH PATTERN (confirmed against a production vendor API):\n1. POST to token endpoint with cc:http-out\n2. cc:json-to-xml to parse the token response\n3. cc:eval to extract access_token and build "Bearer {token}" string into props\n4. cc:write (empty message body) to clear the token response body\n5. cc:set-headers to inject Authorization and other headers\n6. All subsequent cc:http-out calls in the same flow carry those headers\n\nFor simple Basic auth use cc:http-basic-auth child on cc:http-out instead — no set-headers needed.\n\nADDITIONAL ATTRIBUTE (confirmed in production): clear-all="true" on cc:set-headers itself clears all existing headers before processing children — equivalent to cc:remove-headers but at the element level.',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps)',
    xml_example: `<!-- ── Full OAuth2 token refresh pattern (confirmed: production vendor API) ────────

Step 1: POST to OAuth token endpoint -->
<cc:http-out id="GetAccessToken" routes-response-to="InjectToken"
  endpoint="https://auth.example.com/oauth/token?grant_type=refresh_token&amp;refresh_token=@{props['refresh_token']}"
  http-method="POST"/>

<!-- Step 2: Parse token response, build header, inject into message -->
<cc:async-mediation id="InjectToken" routes-to="CallApi" handle-downstream-errors="true">
  <cc:steps>
    <!-- Parse JSON token response to XML for xpath -->
    <cc:json-to-xml id="ParseToken" nested-array-name="row" root-element-name="root"/>
    <!-- Extract token and build "Bearer {token}" string -->
    <cc:eval id="ExtractToken">
      <cc:expression>props['access_token'] = parts[0].xpath('root/data/access_token')</cc:expression>
      <cc:expression>props['auth_header']   = 'Bearer ' + props['access_token']</cc:expression>
    </cc:eval>
    <!-- Clear response body — otherwise the token JSON body flows into the next API call -->
    <cc:write id="ClearBody"><cc:message></cc:message></cc:write>
    <!-- Inject Authorization and other headers (cc:remove-headers clears stale ones first) -->
    <cc:set-headers id="SetAuthHeaders">
      <cc:remove-headers/>
      <cc:add-headers>
        <cc:add-header name="Authorization"   value="@{props['auth_header']}"/>
        <cc:add-header name="Accept-Encoding" value="gzip, deflate, br"/>
        <cc:add-header name="x-api-key"       value="@{props['api_key']}"/>
      </cc:add-headers>
    </cc:set-headers>
  </cc:steps>
  <cc:send-error id="TokenError" rethrow-error="false" routes-to="PutIntegrationMessage"/>
</cc:async-mediation>

<!-- Step 3: API call — Authorization header is already on the message -->
<cc:http-out id="CallApi" routes-response-to="HandleResponse"
  endpoint="@{props['api_base_url']}/v1/resource"
  http-method="GET"/>

<!-- ── Basic Auth alternative — no set-headers needed: -->
<cc:http-out id="BasicAuthCall" routes-response-to="HandleResponse"
  endpoint="@{props['url']}" http-method="PATCH">
  <cc:http-basic-auth username="@{props['username']}" password="@{props['password']}"/>
</cc:http-out>`,
  },
  'json-to-xml': {
    description: 'Converts a JSON HTTP response body to XML so XPath can extract values. Use immediately after cc:http-out (inside the routes-response-to async-mediation) before any cc:eval that calls parts[0].xpath(). Without this step, parts[0].xpath() returns empty on JSON payloads.\n\nTHREE KEY ATTRIBUTE COMBINATIONS (confirmed in production builds):\n\n1. nested-array-name="row" root-element-name="root" — for responses where the payload is a top-level array. Each array item becomes a <row> child of the root element.\n   JSON: {"data": [{"access_token": "abc"}]} → <root><data><access_token>abc</access_token></data></root>\n\n2. nested-object-name="record" — for paginated list responses wrapped in an outer object. The outer object and its fields become children of <record>.\n   JSON: {"count": 100, "data": [...]} → <root><record><count>100</count><data>...</data></record></root>\n\n3. No attributes — minimal conversion for flat JSON objects.\n   JSON: {"key": "value"} → <root><key>value</key></root>\n\nALWAYS extract needed values with cc:eval + parts[0].xpath() immediately after cc:json-to-xml. If you subsequently call cc:xslt-plus or cc:write, the message changes and xpath no longer works.',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps)',
    xml_example: `<!-- ── Pattern 1: array response (e.g. OAuth token with data array) ─────
  JSON: {"data": [{"access_token": "abc123", ...}]}
  Use: nested-array-name + root-element-name -->
<cc:json-to-xml id="ParseTokenResponse" nested-array-name="row" root-element-name="root"/>
<!-- XPath: parts[0].xpath('root/data/access_token') -->

<!-- ── Pattern 2: paginated list with metadata wrapper ───────────────────
  JSON: {"count": 100, "data": [{record 1}, {record 2}]}
  Use: nested-object-name to unwrap the outer object -->
<cc:json-to-xml id="ParseListResponse" nested-object-name="record"/>
<!-- XPath count: parts[0].xpath('root/record/count') -->
<!-- XPath items: parts[0].xpath('count(/root/record/data)') -->

<!-- ── Pattern 3: flat JSON object ──────────────────────────────────────
  JSON: {"employeeId": "E123", "status": "Active"}
  No attributes needed -->
<cc:json-to-xml id="ParseSimpleResponse"/>
<!-- XPath: parts[0].xpath('root/employeeId') -->

<!-- ── Full context: extract BEFORE any transform ────────────────────────
  Always follow with cc:eval to pull values into props while message is XML.
  After cc:xslt-plus or cc:write, parts[0].xpath() will not work. -->
<cc:async-mediation id="ProcessApiResponse" routes-to="NextStep">
  <cc:steps>
    <cc:json-to-xml id="JsonToXml" nested-object-name="record"/>
    <cc:eval id="ExtractValues">
      <cc:expression>props['result_count'] = parts[0].xpath('root/record/count')</cc:expression>
      <cc:expression>props['data_count']   = parts[0].xpath('count(/root/record/data)')</cc:expression>
    </cc:eval>
    <cc:xslt-plus id="MapToOutput" output-mimetype="text/csv" url="MapOutput.xsl"/>
  </cc:steps>
</cc:async-mediation>`,
  },
  'validate-exp': {
    description: 'Throws a runtime error with a custom message if the MVEL expression evaluates false. Use inside cc:async-mediation cc:steps to guard against invalid states before processing. The error propagates to the nearest cc:send-error handler on the same or parent async-mediation.\n\nSyntax: MVEL expression is the text content of cc:expression. The failure-message attribute on cc:expression is the error text delivered to the integration event.\n\nCOMMON PATTERNS:\n- da.size() > 0 — validate uploaded file exists (da = document attachments collection)\n- props[\'count\'] > 0 — validate parsed CSV has rows\n- props[\'record_count\'] > 0 — validate API response has data\n- props[\'worker_id\'] != \'\' — validate a required value extracted from XPath is not empty\n\nAlways pair with handle-downstream-errors="true" and a cc:send-error on the same async-mediation.',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps; throws error on false)',
    xml_example: `<!-- Validate uploaded documents exist -->
<cc:validate-exp id="ValidateFileUploaded">
  <cc:expression failure-message="There are no files uploaded">da.size() > 0</cc:expression>
</cc:validate-exp>

<!-- Validate parsed CSV has data rows -->
<cc:validate-exp id="ValidateFileNotEmpty">
  <cc:expression failure-message="The uploaded file is empty">props['count'] > 0</cc:expression>
</cc:validate-exp>

<!-- Validate API response returned records -->
<cc:validate-exp id="ValidateApiHasData">
  <cc:expression failure-message="No records returned from API">props['record_count'] > 0</cc:expression>
</cc:validate-exp>

<!-- Validate required prop is non-empty after extraction -->
<cc:validate-exp id="ValidateWorkerID">
  <cc:expression failure-message="Worker ID not found in response">props['worker_id'] != '' &amp;&amp; props['worker_id'] != null</cc:expression>
</cc:validate-exp>

<!-- Full context: inside async-mediation with send-error handler -->
<cc:async-mediation id="CheckAndProcess" routes-to="SplitRows" handle-downstream-errors="true">
  <cc:steps>
    <cc:validate-exp id="ValidateHasRows">
      <cc:expression failure-message="File has no data rows">props['row_count'] > 0</cc:expression>
    </cc:validate-exp>
    <!-- Only reached if validation passes -->
    <cc:xslt-plus id="TransformRows" output-mimetype="text/xml" url="MapRows.xsl"/>
  </cc:steps>
  <cc:send-error id="ValidateError" rethrow-error="false" routes-to="PutValidationError"/>
</cc:async-mediation>`,
  },
  'cloud-log': {
    description: 'Writes an entry to the Workday integration event log — the audit trail visible in the Workday UI under Integration Events. DIFFERENT from cc:log, which writes to the Studio console only.\n\nUse cc:cloud-log for business-level milestones that operators and auditors need to see: worker hired, position created, API call succeeded, fatal error occurred.\n\nAttributes (all support @{} MVEL interpolation):\n- level — severity. Confirmed values from production: info, fatal. (Presumably also: error, warn, debug.)\n- message — short summary string. Required.\n- message-details — longer detail string. Optional but recommended for context.\n- reference-id — a Workday object WID or business ID for a traceable audit link. Optional. Can be a bare expression without @{}: reference-id="props[\'p.WorkdayID\']"\n\nPATTERN: place cc:cloud-log immediately after the step that creates/updates an object. On fatal errors, place inside the error handler. A strong audit trail uses reference-id to link each log entry to the Workday object it describes.',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps)',
    xml_example: `<!-- Log a successful hire with full audit context -->
<cc:cloud-log id="LogHireSuccess"
  level="info"
  message="Contingent Worker Successfully Hired"
  message-details="Applicant ID: @{props['p.applicant.id']} | CW ID: @{props['p.Contingent.Worker.id']}"
  reference-id="props['p.Contingent.Worker.wid']"/>

<!-- Log a created position (minimal form) -->
<cc:cloud-log id="LogPositionCreated"
  level="info"
  message="Position Successfully Created"
  message-details="@{props['p.Position.id']}"
  reference-id="props['p.Position.wid']"/>

<!-- Log a fatal error with full error context -->
<cc:cloud-log id="LogFatalError"
  level="fatal"
  message="@{props['error_message']}"
  message-details="@{props['error_message_details']}"
  reference-id="props['p.WorkdayID']"/>

<!-- Log a role assignment (no details needed) -->
<cc:cloud-log id="LogRoleAssigned"
  level="info"
  message="Assigned Manager Role Successfully"
  reference-id="props['p.Created.Supervisory.Org.wid']"/>

<!-- COMPARISON:
     cc:cloud-log → Workday UI > Integration Events (business audit trail)
     cc:log       → Studio console / server log only (developer debug) -->`,
  },
  'aggregator': {
    description: 'Recombines split messages into one after a cc:splitter has processed records individually. Collects each processed message and concatenates them when the batch condition fires.\n\nKEY ATTRIBUTES on cc:aggregator:\n- routes-to — where to route after aggregation releases the batch\n- force-batch-when — MVEL expression evaluated after each incoming message; batch fires when it evaluates true. Typical patterns: pagination complete (props[\'offset\'] >= props[\'total\']), data exhausted (props[\'data_count\'] == 0)\n- force-batch-on-last-message — set to false when using force-batch-when for explicit control\n\nCHILD ELEMENTS:\n- cc:size-batch-strategy batch-size="-1" — collect ALL messages (required when using force-batch-when)\n- cc:message-content-collater — concatenates the body of each collected message. Add cc:header-text child to prepend a CSV header line before all rows.\n\nPAGINATION PATTERN: each loop iteration fetches a page → splitter splits rows → each row is processed + routes to aggregator → when pagination ends, aggregator releases the full document.',
    routes_via: 'routes-to (after batch fires)',
    xml_example: `<!-- ── Basic aggregator (no CSV header) ─────────────────────────────────
  Fires when pagination offset has passed total count. -->
<cc:aggregator id="CollectUsers" routes-to="SaveFile"
  force-batch-on-last-message="false"
  force-batch-when="props['offset'] >= props['response_count']">
  <cc:size-batch-strategy batch-size="-1"/>
  <cc:message-content-collater/>
</cc:aggregator>

<!-- ── Aggregator with CSV column header ─────────────────────────────────
  cc:header-text is prepended as the first line of the collected output.
  Match the separator (|) and column order to your XSL output. -->
<cc:aggregator id="CollectActivity" routes-to="SaveActivityFile"
  force-batch-on-last-message="false"
  force-batch-when="props['data_count'] == 0">
  <cc:size-batch-strategy batch-size="-1"/>
  <cc:message-content-collater>
    <cc:header-text>EmployeeID|FirstName|LastName|Department|Location|EventDate</cc:header-text>
  </cc:message-content-collater>
</cc:aggregator>

<!-- ── After aggregator: save to variable then persist ───────────────────
  cc:copy snapshots aggregated content; cc:store delivers it as a file on the event. -->
<cc:async-mediation id="SaveFile" routes-to="DeliverFile">
  <cc:steps>
    <cc:copy id="SaveCsv" output="variable" output-variable="output_csv"/>
    <cc:store id="StoreFile" createDocumentReference="true" expiresIn="P30D" title="report.csv"/>
    <cc:eval id="SignalLoopDone">
      <cc:expression>props['loop_break'] = true</cc:expression>
    </cc:eval>
  </cc:steps>
</cc:async-mediation>`,
  },
  'xslt': {
    description: 'Applies an XSLT stylesheet producing XML output. Unlike cc:xslt-plus (which supports any output-mimetype), cc:xslt always produces XML and does not set a Content-Type header. Use for XML→XML transforms: building Workday SOAP request envelopes, restructuring data between Workday services, or extracting sub-documents.\n\ncc:xslt is an inline step inside cc:async-mediation cc:steps. The url attribute is relative to ws/WSAR-INF/.\n\nWHEN TO USE WHICH:\n- cc:xslt — XML in, XML out. No Content-Type change. Use for SOAP request building.\n- cc:xslt-plus — XML in, any format out (CSV, JSON, text). Required for non-XML output. Sets Content-Type automatically.\n- cc:transform — legacy top-level step (not inside async-mediation). Use cc:xslt instead.',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps)',
    xml_example: `<!-- Build a Workday SOAP envelope from the current message -->
<cc:xslt id="BuildGetWorkersRequest" url="GetWorkersRequest.xsl"/>

<!-- Restructure XML between two Workday SOAP calls -->
<cc:xslt id="MapManagerInfo" url="GETManagerInfo.xsl"/>

<!-- Build a SOAP hire request from extracted props -->
<cc:xslt id="BuildHireRequest" url="PutApplicant.xsl"/>

<!-- Full context: inside async-mediation before a SOAP call -->
<cc:async-mediation id="BuildSoapEnvelope" routes-to="CallWorkday" handle-downstream-errors="true">
  <cc:steps>
    <cc:eval id="SetParams">
      <cc:expression>props['Worker_ID'] = lp.getSimpleData('Employee_ID')</cc:expression>
    </cc:eval>
    <!-- cc:xslt reads current message + any xsl:params from props -->
    <cc:xslt id="BuildRequest" url="GetWorkersRequest.xsl"/>
  </cc:steps>
  <cc:send-error id="XsltError" rethrow-error="false" routes-to="PutBuildError"/>
</cc:async-mediation>
<cc:workday-out-soap id="CallWorkday" routes-response-to="ProcessResponse"
  application="Human_Resources" version="v40.0"/>`,
  },
  'write': {
    description: 'Replaces the current message body with the content of its embedded cc:message block. Used to build SOAP/REST request bodies from literal XML + MVEL @{...} interpolation, clear the message body before setting headers, or write a stub XML input for cc:xslt-plus.\n\nKEY ATTRIBUTE: output-mimetype — sets the Content-Type of the written content (e.g. "text/xml", "text/plain", "application/json"). Default is text/xml.\n\noutput="variable" + output-variable="varName" form writes into a named variable instead of the current message context.\n\ncc:message children:\n- cc:text — literal string content. Use &lt; and &gt; for XML tags inside it, or just write plain text.\n- cc:message-content — inserts current message body at this position.\n\nCOMMON PATTERNS:\n1. Stub XML for cc:xslt-plus: write <request/>, then xslt-plus reads only xsl:params from props\n2. Clear body after token fetch: write empty cc:message before cc:set-headers so the OAuth response body does not flow into the next API call\n3. Build SOAP envelope inline: write complete XML string with @{props[...]} interpolation inside cc:text\n\nGOTCHA — cc:message-content takes NO attributes. Adding maxlength="2000" (or any attribute) causes a schema validation error: "Attribute \'maxlength\' is not allowed to appear in element \'cc:message-content\'". To truncate log output, use a cc:text with MVEL inside cc:log-message instead:\n  <cc:text>@{parts[0].text.length() > 2000 ? parts[0].text.substring(0,2000) + \'...\' : parts[0].text}</cc:text>',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps)',
    xml_example: `<!-- ── Build a SOAP request inline (no XSL file needed) ──────────────────
  Write a complete XML string with MVEL interpolation. -->
<cc:write id="BuildSoapBody" output-mimetype="text/xml">
  <cc:message>
    <cc:text>&lt;?xml version="1.0" encoding="UTF-8"?&gt;
&lt;env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:wd="urn:com.workday/bsvc"&gt;
  &lt;env:Body&gt;
    &lt;wd:Get_Workers_Request wd:version="v40.0"&gt;
      &lt;wd:Request_References&gt;
        &lt;wd:Worker_Reference&gt;
          &lt;wd:ID wd:type="Employee_ID"&gt;@{props['Employee_ID']}&lt;/wd:ID&gt;
        &lt;/wd:Worker_Reference&gt;
      &lt;/wd:Request_References&gt;
    &lt;/wd:Get_Workers_Request&gt;
  &lt;/env:Body&gt;
&lt;/env:Envelope&gt;</cc:text>
  </cc:message>
</cc:write>

<!-- ── Stub XML for cc:xslt-plus (input must be valid XML) ───────────────
  The XSL ignores <request/> and reads only xsl:params populated from props. -->
<cc:write id="PrepareStub">
  <cc:message><cc:text>&lt;request/&gt;</cc:text></cc:message>
</cc:write>
<cc:xslt-plus id="BuildJson" output-mimetype="application/json" url="Build.xsl"/>

<!-- ── Clear message body after OAuth token fetch ────────────────────────
  Prevents the token response JSON from flowing into the next http-out call. -->
<cc:write id="ClearBody"><cc:message></cc:message></cc:write>

<!-- ── Write into a variable (for test injection or log building) ─────────
  output="variable" + output-variable routes output to a named variable. -->
<cc:write id="InjectTestData" output="variable" output-mimetype="text/plain" output-variable="wd.retrieve.variable">
  <cc:message>
    <cc:text>{"candidate_id": 12345, "first_name": "Jane"}</cc:text>
  </cc:message>
</cc:write>

<!-- ── HTML email body ────────────────────────────────────────────────────
  output-mimetype must be set; the following cc:email-out reads this as body. -->
<cc:write id="BuildEmailBody" output-mimetype="text/html">
  <cc:message>
    <cc:text>Hello @{props['Recruiter_Name']},&lt;br&gt;&lt;br&gt;
The hire of &lt;b&gt;@{props['First_Name']} @{props['Last_Name']}&lt;/b&gt; failed.&lt;br&gt;
Reason: @{props['Error_Message']}&lt;br&gt;&lt;br&gt;
Please contact HR Ops.&lt;br&gt;</cc:text>
  </cc:message>
</cc:write>`,
  },
  'store': {
    description: 'Persists the current message (or a variable) as a named document that can later be attached to the integration event via vm://wcc/PutIntegrationMessage. The stored document is referenced by setting is.document.variable.name to the output-variable name on the PutIntegrationMessage call.\n\nKEY ATTRIBUTES:\n- output="variable" + output-variable="varName" — stores the document reference into a named variable\n- input="message" or input="variable" + input-variable — source of content to store\n- createDocumentReference="true/false" — whether to create a Workday document reference\n- expiresIn — ISO-8601 duration string for document retention (e.g. "P30D" = 30 days)\n- title — display name of the document (filename)\n- contentDisposition — sets the attachment filename, e.g. attachment;filename="report.csv"\n- schema="http://www.w3.org/2005/Atom" + summary + title — Atom entry metadata for WD document taxonomy\n\nPATTERN: cc:store is always followed by a cc:local-out to vm://wcc/PutIntegrationMessage with is.document.variable.name set to the same variable name.\n\nAlso used as cc:store (simpler form, no output-variable) to persist a file directly as a deliverable to the integration event.',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps)',
    xml_example: `<!-- ── Store a CSV file to the integration event (production pattern) ─────────
  After cc:aggregator releases collected CSV rows: -->
<cc:async-mediation id="PersistFile" routes-to="DeliverFile">
  <cc:steps>
    <cc:copy id="Snapshot" output="variable" output-variable="output_csv"/>
    <!-- createDocumentReference=true → makes it a deliverable attachment -->
    <cc:store id="StoreFile" createDocumentReference="true" expiresIn="P30D" title="report.csv"/>
  </cc:steps>
</cc:async-mediation>

<!-- ── Store a document with full Atom metadata (production pattern) ──────────
  The document is stored in a variable; PutIntegrationMessage delivers it. -->
<cc:store id="StoreDoc"
  output="variable" output-mimetype="text/plain" output-variable="UFileOut_FileReference"
  input="message"
  contentDisposition="attachment;filename=&quot;@{props['UFileOut_FileName']}&quot;"
  createDocumentReference="false"
  expiresIn="@{props['UFileOut_TmpRetention']}"
  schema="http://www.w3.org/2005/Atom"
  summary="@{'File: ' + props['UFileOut_FileName']}"
  title="@{props['UFileOut_FileName']}"/>

<!-- Deliver the stored document as an attachment on the event -->
<cc:local-out id="AttachToEvent" store-message="none"
  endpoint="vm://wcc/PutIntegrationMessage"
  clone-request="true">
  <cc:set name="is.document.variable.name" value="'UFileOut_FileReference'"/>
  <cc:set name="is.document.deliverable"   value="'true'"/>
</cc:local-out>

<!-- ── Store from a variable (not from message) ──────────────────────────
  Use when content was already captured in a variable earlier in the flow. -->
<cc:store id="StoreFromVar"
  output="variable" output-mimetype="text/plain" output-variable="doc_ref"
  input="variable" input-variable="UFileOut_Tmp"
  createDocumentReference="false"
  expiresIn="P30D"
  title="audit_log.csv"/>`,
  },
  'base64-encode': {
    description: 'Base64-encodes the current message (or a variable) and writes the result into a named output variable or back to the message. Used for two main purposes:\n\n1. BUILDING BASIC AUTH HEADERS: write "ApiKey:" to message → cc:base64-encode → use output variable as the Authorization header value: "Basic {encoded}"\n\n2. ENCODING BINARY FILES FOR SOAP: fetch a binary file (PDF, image) from an API → cc:base64-encode into a variable → embed the encoded string in a wd:Worker_Document SOAP request body\n\nKEY ATTRIBUTES:\n- output="variable" + output-variable="varName" — writes encoded content to a variable\n- output-mimetype — sets MIME type of the output (usually "text/plain")\n- input="message" — reads from current message (default); omit when current message is the implicit source',
    routes_via: 'none (inline step inside cc:async-mediation cc:steps)',
    xml_example: `<!-- ── Basic Auth header from API key (Greenhouse pattern) ──────────
  Step 1: write "APIKey:" to message (colon makes it a Basic auth credential) -->
<cc:write id="PrepareKey" output-mimetype="text/plain">
  <cc:message><cc:text>@{props['GH_API_Key']}:</cc:text></cc:message>
</cc:write>
<!-- Step 2: base64-encode the message, store in variable -->
<cc:base64-encode id="EncodeKey"
  output="variable" output-mimetype="text/plain"
  output-variable="API_Key_Encoded"
  input="message"/>
<!-- Step 3: inject as Authorization header on the next http-out -->
<cc:set-headers id="SetBasicAuth">
  <cc:remove-headers/>
  <cc:add-headers>
    <cc:add-header name="Authorization" value="Basic @{vars['API_Key_Encoded'].getText()}"/>
  </cc:add-headers>
</cc:set-headers>

<!-- ── Encode a binary file fetched from REST API ────────────────────────
  After cc:http-out GET returns a PDF blob: -->
<cc:base64-encode id="EncodePdf"
  output="variable"
  output-variable="filebase64"/>
<!-- Then embed vars['filebase64'].getText() in a wd:Put_Worker_Document SOAP body -->`,
  },
  'email-out': {
    description: 'Sends the current message body as an email via SMTP. The message body must already be set (typically by a preceding cc:write with output-mimetype="text/html" or "text/plain"). Used for error notification emails to business users (recruiters, HR ops) when processing fails.\n\nKEY ATTRIBUTES:\n- endpoint — "mailto:{recipient}" URI. Supports @{} interpolation.\n- subject — email subject line. Supports @{} interpolation.\n- host — SMTP host (e.g. AWS SES: email-smtp.us-east-1.amazonaws.com)\n- port — SMTP port (587 for STARTTLS)\n- starttls — "true" for STARTTLS\n- user / password — SMTP credentials (typically stored in integration attributes)\n- from, reply-to — sender headers\n- bcc, cc — additional recipients (semicolon-delimited)\n- execute-when — MVEL condition to skip on impl environments\n\nENVIRONMENT ROUTING PATTERN: Use two cc:email-out elements with mutually exclusive execute-when conditions:\n- Prod instance: sends to actual recruiter, execute-when="props[\'Is_Impl\'] == false"\n- Impl instance: sends only to internal test address, execute-when="props[\'Is_Impl\'] == true"\n\nRequires a cc:custom-headers child (empty element).',
    routes_via: 'routes-response-to (optional)',
    xml_example: `<!-- ── Full error notification pattern (prod/impl split) ──────────────
  Step 1: build HTML body -->
<cc:write id="BuildErrorEmail" output-mimetype="text/html">
  <cc:message>
    <cc:text>Hello @{props['Recruiter_Name']},&lt;br&gt;&lt;br&gt;
Failed processing hire for &lt;b&gt;@{props['First_Name']} @{props['Last_Name']}&lt;/b&gt;.&lt;br&gt;
Reason: @{props['Email_Failure_Reason']}&lt;br&gt;&lt;br&gt;
Contact HR Ops to resolve.&lt;br&gt;</cc:text>
  </cc:message>
</cc:write>

<!-- Step 2: send to recruiter (prod only) -->
<cc:email-out id="EmailOut_Prod"
  execute-when="props['Is_Impl'] == false"
  routes-response-to="EmailOut_Impl"
  endpoint="mailto:@{props['Recruiter_Email']}"
  bcc="hr-ops@example.com"
  cc="@{props['cc_address']}"
  from="hr-system@example.com"
  reply-to="hr-system@example.com"
  host="email-smtp.us-east-1.amazonaws.com"
  port="587"
  starttls="true"
  user="@{props['SMTP_Username']}"
  password="@{props['SMTP_Password']}"
  subject="Hire failed: @{props['First_Name']} @{props['Last_Name']}">
  <cc:custom-headers/>
</cc:email-out>

<!-- Step 3: send to internal test only (impl only) -->
<cc:email-out id="EmailOut_Impl"
  execute-when="props['Is_Impl'] == true"
  endpoint="mailto:int-dev-testing@example.com"
  from="hr-system@example.com"
  host="email-smtp.us-east-1.amazonaws.com"
  port="587"
  starttls="true"
  user="@{props['SMTP_Username']}"
  password="@{props['SMTP_Password']}"
  subject="[IMPL] Hire failed: @{props['First_Name']} @{props['Last_Name']}">
  <cc:custom-headers/>
</cc:email-out>`,
  },
  'set': {
    description: 'cc:set is a child element of cc:local-out (and vm://wcc/* built-in endpoints). It passes named parameters to the target sub-flow or platform endpoint. The caller writes cc:set children; the sub-flow reads the values as props.\n\nSYNTAX: <cc:set name="paramName" value="EXPRESSION"/>\n\nVALUE EXPRESSION RULES:\n- String literal: value="\'literalString\'"\n- Prop reference: value="props[\'key\']"\n- MVEL expression: value="props[\'a\'] + \' \' + props[\'b\']" — use + for arithmetic/string concat in MVEL values\n- Message body: value="message" — passes the current message body as the param\n- Boolean: value="true" or value="false" (no quotes)\n\nSTRING CONCATENATION WITH # OPERATOR (confirmed INT_Studio_StarterKit assembly.xml):\nInside assembly.xml attribute values (NOT cc:eval MVEL expressions), the # character is the string concatenation operator. This appears in cc:set value, cc:description, and other attribute strings where a literal + would be ambiguous.\n  value="props[\'inWebServiceApplication\'] #\' application HTTP request error\'"\nvs cc:eval MVEL (uses +):\n  props[\'msg\'] = props[\'app\'] + \' error\'  // same result, different context\n\nKEY PLATFORM PARAMS for vm://wcc/PutIntegrationMessage:\n- is.document.file.name — filename of the deliverable\n- is.document.deliverable — "true" or "false"\n- is.document.variable.name — name of a variable previously set with cc:store\n- is.message.severity — "INFO", "WARNING", "ERROR", "CRITICAL"\n- is.message.summary — short summary line shown on the integration event\n- is.message.detail — longer detail text\n- ie.event.wid — integration event WID (for vm://wcc/GetEventDocuments)',
    routes_via: 'none (child element of cc:local-out)',
    xml_example: `<!-- ── cc:set children on cc:local-out (all value forms) ─────────────────

String literal (single quotes required inside double-quoted attribute): -->
<cc:local-out id="DeliverFile" store-message="none"
  endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.document.file.name"     value="'workers.csv'"/>
  <cc:set name="is.document.deliverable"   value="'true'"/>
  <cc:set name="is.message.severity"       value="'INFO'"/>
  <cc:set name="is.message.summary"        value="'Worker file delivered successfully'"/>
</cc:local-out>

<!-- Prop reference: -->
<cc:local-out id="CallSub" store-message="none"
  endpoint="vm://INT_SSK/MySub">
  <cc:set name="workerName" value="props['Full_Name']"/>
  <cc:set name="apiVersion" value="props['globalApiVersion']"/>
</cc:local-out>

<!-- # string concatenation operator in assembly.xml attribute values
     (confirmed INT_Studio_StarterKit assembly.xml line 834):
     value is evaluated as a template expression where # is the concat operator. -->
<cc:local-out id="DeliverError" store-message="none"
  endpoint="vm://wcc/PutIntegrationMessage">
  <cc:set name="is.message.summary"
    value="props['inWebServiceApplication'] #' application HTTP request error'"/>
  <!-- Result: e.g. "Dayforce application HTTP request error" -->
</cc:local-out>

<!-- Message body as param value: -->
<cc:local-out id="PassMessage" store-message="none"
  endpoint="vm://INT_SSK/ProcessXml">
  <cc:set name="soapRequestXml" value="message"/>
</cc:local-out>

<!-- MVEL expression (same + operator as cc:eval): -->
<cc:local-out id="BuildPath" store-message="none"
  endpoint="vm://INT_SSK/CallRest">
  <cc:set name="apiPath"
    value="props['apiBase'] + '/v1/workers/' + props['workerId']"/>
</cc:local-out>`,
  },
  'ssk-component-pattern': {
    description: 'The INT_Studio_StarterKit (SSK) provides a library of reusable sub-flow components — CallSoap, CallRaaS, CallSoapPaged, PopulateJavaMap, and 15+ others. This entry documents the canonical calling convention.\n\nSSK CALLING CONVENTION:\n1. Set up component inputs via cc:set children on cc:local-out\n2. Call the component via vm://{integrationSystemName}/{ComponentId}\n3. Wait for response via routes-response-to\n4. Call Finally_{ComponentId} unconditionally afterward for cleanup\n5. Read cc:out-parameter values from props after response returns\n\nKEY SSK COMPONENTS:\n- CallSoap — single Workday SOAP call. Inputs: soapRequestXml, globalApiVersion, sskIsDebugMode. Outputs: soapResponseXml, callStatus.\n- CallRaaS — RAAS report fetch (workday-out-rest wrapper). Inputs: raasExtraPath, sskIsDebugMode. Outputs: raasResponseXml.\n- CallSoapPaged — paginated SOAP call for large result sets. Inputs: soapRequestXml, pageSize, globalApiVersion. Outputs: soapResponseXml (accumulated).\n- PopulateJavaMap — builds a java.util.HashMap for O(1) lookups. Inputs: keyXpath, valueXpath, dataXml. Outputs: javaMap (in-memory map object).\n\nFINALLY PATTERN: every SSK component has a matching Finally_{ComponentId} sub-flow. Call it unconditionally after the component finishes (both on success AND on error paths). The Finally sub-flow resets component-scoped props, logs completion status, and signals the parent flow.\n\nFRAMEWORK GLOBALS (set once at assembly entry, read everywhere):\n- props[\'sskIsDebugMode\'] — enable verbose CloudLog debug entries in every component\n- props[\'globalApiVersion\'] — Workday API version (e.g. "43.0") passed to all SOAP/REST calls\n- props[\'cc.customer.id\'] — tenant name (set by Studio, read-only)',
    routes_via: 'routes-response-to (on the calling cc:local-out)',
    xml_example: `<!-- ── Calling a SSK component: full pattern ─────────────────────────────

Step 1: set framework globals (once, at assembly entry) -->
<cc:async-mediation id="InitFramework" routes-to="CallSoapComponent">
  <cc:steps>
    <cc:eval id="SetGlobals">
      <cc:expression>props['sskIsDebugMode']   = intsys.getAttributeAsBoolean('SSK Debug Mode')</cc:expression>
      <cc:expression>props['globalApiVersion'] = intsys.getAttribute('API Version')</cc:expression>
    </cc:eval>
  </cc:steps>
</cc:async-mediation>

<!-- Step 2: build the SOAP envelope using cc:xslt, store as message -->
<cc:async-mediation id="BuildSoapEnv" routes-to="CallGetWorkers">
  <cc:steps>
    <cc:xslt id="BuildEnvelope" url="GetWorkers_Request.xsl"/>
  </cc:steps>
  <cc:send-error id="BuildEnvErr" rethrow-error="false" routes-to="PutBuildError"/>
</cc:async-mediation>

<!-- Step 3: call the SSK CallSoap component -->
<cc:local-out id="CallGetWorkers" store-message="none"
  routes-response-to="Finally_CallGetWorkers"
  endpoint="vm://INT_SSK/CallSoap">
  <cc:set name="soapRequestXml"    value="message"/>
  <cc:set name="globalApiVersion"  value="props['globalApiVersion']"/>
  <cc:set name="sskIsDebugMode"    value="props['sskIsDebugMode']"/>
</cc:local-out>

<!-- Step 4: call Finally_ unconditionally (cleanup, logging, state reset) -->
<cc:local-out id="Finally_CallGetWorkers" store-message="none"
  routes-response-to="ProcessWorkerResponse"
  endpoint="vm://INT_SSK/Finally_CallSoap"/>

<!-- Step 5: use the output written by the component -->
<cc:async-mediation id="ProcessWorkerResponse" routes-to="SplitWorkers">
  <cc:steps>
    <!-- soapResponseXml was written to props by the CallSoap component -->
    <cc:eval id="CheckCallStatus">
      <cc:expression>props['call_ok'] = (props['callStatus'] == 'SUCCESS')</cc:expression>
    </cc:eval>
  </cc:steps>
</cc:async-mediation>


<!-- ── PopulateJavaMap component: O(1) lookups ───────────────────────────
     Builds a HashMap from an XML dataset (e.g. a RAAS lookup report).
     After component returns, props['javaMap'].get(key) does O(1) lookup. -->
<cc:local-out id="BuildPayPolicyMap" store-message="none"
  routes-response-to="Finally_BuildPayPolicyMap"
  endpoint="vm://INT_SSK/PopulateJavaMap">
  <cc:set name="keyXpath"   value="'wd:PayPolicy_XRef'"/>
  <cc:set name="valueXpath" value="'wd:DF_PayPolicy_Code'"/>
  <cc:set name="dataXml"    value="message"/>
</cc:local-out>
<cc:local-out id="Finally_BuildPayPolicyMap" store-message="none"
  routes-response-to="NextStep"
  endpoint="vm://INT_SSK/Finally_PopulateJavaMap"/>

<!-- Later in a per-record step: -->
<cc:eval id="LookupPayPolicy">
  <cc:expression>props['DF_PayPolicy'] = props['javaMap'].get(props['WD_PayPolicy'])</cc:expression>
</cc:eval>`,
  },
  'decorations': {
    description: 'Colored text annotation elements in assembly-diagram.xml. Decorations appear as styled text labels (not boxes or shapes) overlaid on a swimlane or element in the Studio canvas. Used in INT_Studio_StarterKit and complex assemblies to annotate what a band/sub-flow does without adding a cc:note (which is schema-invalid in assembly.xml).\n\nNOTE: cc:note is INVALID in assembly.xml (crashes Studio). Decorations in assembly-diagram.xml are the correct way to add visual annotation text.\n\nDECORATION ELEMENT:\n- Must appear inside a <visualProperties> or swimlane block in assembly-diagram.xml\n- Attributes: bgColor (hex), fontColor (hex), type ("NOTE" or similar)\n- Text content is the annotation string displayed in Studio\n\nCONFIRMED FROM INT_Studio_StarterKit assembly-diagram.xml.',
    routes_via: 'none (assembly-diagram.xml only)',
    xml_example: `<!-- ── assembly-diagram.xml: colored text decorations ────────────────────
     Decorations annotate swimlanes or element groups with styled text.
     Use instead of cc:note (which is schema-invalid in assembly.xml). -->

<!-- Example from INT_Studio_StarterKit: annotation on a sub-flow swimlane -->
<swimlanes x="30" y="800" name="CallSoap" alignment="START">
  <elements href="assembly.xml#CallSoap"/>

  <!-- Decoration: styled text label inside this swimlane -->
  <decorations bgColor="#E3F2FD" fontColor="#0D47A1" type="NOTE">
    Calls Workday SOAP API. Inputs: soapRequestXml, globalApiVersion.
    Outputs: soapResponseXml, callStatus. Call Finally_CallSoap after.
  </decorations>
</swimlanes>

<!-- Green annotation (success/happy-path band): -->
<decorations bgColor="#E8F5E9" fontColor="#1B5E20" type="NOTE">
  Happy path: worker found, hire event processed, CSV delivered.
</decorations>

<!-- Red annotation (error band): -->
<decorations bgColor="#FFEBEE" fontColor="#B71C1C" type="NOTE">
  Error path: HTTP fault or SOAP fault. Delivers error message to event.
</decorations>

<!-- Yellow annotation (framework globals band): -->
<decorations bgColor="#FFFDE7" fontColor="#F57F17" type="NOTE">
  Framework init: sets sskIsDebugMode, globalApiVersion, tenant props.
</decorations>`,
  },
  'custom': {
    description: 'Calls a custom Java bean as a step inside cc:steps. Use when XSLT/MVEL cannot do the job — typically when you need an Apache HttpClient call (e.g. following a 302 redirect with auth preserved), complex string parsing, or anything that requires actual Java APIs.\n\nWHEN TO USE A JAVA BEAN OVER MVEL:\n- Need a real HTTP library (Studio MVEL cannot Class.forName(\'org.apache.http.*\') — DelegatingClassLoader blocks runtime class loading)\n- Need to follow a redirect with auth preserved (cc:http-basic-auth drops creds on redirect)\n- Need any standard Java class not already imported into MVEL\n- Per-record logic too complex for nested ternaries\n\nTWO PATTERNS — choose based on whether you need props access:\n\nPATTERN A: @Component + cc:custom (when bean needs to read/write props)\n\nJava source (project/src/main/java/...):\n  import com.capeclear.assembly.annotation.Component;\n  import com.capeclear.assembly.annotation.ComponentMethod;\n  import static com.capeclear.assembly.annotation.Component.Type.*;\n\n  @Component(name="MyComponent", type=mediation, scope="prototype",\n             toolTip="...", smallIconPath="icons/x_16.png", largeIconPath="icons/x_24.png")\n  public class MyComponent {\n      @ComponentMethod\n      public void process(com.capeclear.mediation.MediationContext ctx) {\n          String input = ctx.getProperty("my.input.prop").toString();\n          // do work\n          ctx.setProperty("my.output.prop", result);\n      }\n  }\n\nAssembly XML — call inside cc:steps:\n  <cc:custom id="RunMyComponent" ref="MyComponent"/>\n\nSpring bean declaration — OUTSIDE cc:assembly, INSIDE the <beans> root, scope MUST be prototype:\n  <beans ...>\n    <cc:assembly ...> ... </cc:assembly>\n    <bean id="MyComponent" class="com.example.integration.MyComponent" scope="prototype"/>\n  </beans>\n\nPATTERN B: Plain POJO via MVEL bean reference (when no props access needed)\n\nJava (no annotations):\n  public class MyHelper {\n      public String compute(String input) { return input.toUpperCase(); }\n  }\n\nAssembly XML — declare bean:\n  <bean id="myHelper" class="com.example.integration.MyHelper" scope="prototype"/>\n\nMVEL call inside cc:eval — Spring registers bean by id as a direct MVEL variable:\n  props[\'result\'] = myHelper.compute(props[\'someInput\']);\n\nWHY THIS WORKS — DelegatingClassLoader bypass:\nMVEL\'s DelegatingClassLoader blocks Class.forName at runtime, so you cannot instantiate new Apache HttpClient instances inside cc:eval. BUT Spring beans are instantiated by the Studio CONTAINER classloader at startup. MVEL can then call methods on the already-alive bean object without any runtime class loading. This sidesteps the restriction entirely.\n\nCRITICAL — Studio runtime HttpClient version (Studio 2025.24):\nThe Studio runtime ships Apache HttpClient 4.2.3, NOT the modern 4.5+ API. If your bean does HTTP, you MUST use the 4.2.x API:\n  - DefaultHttpClient (NOT CloseableHttpClient)\n  - httpClient.getConnectionManager().shutdown() (NOT client.close())\n  - LaxRedirectStrategy\n\nAdd these three JARs to .classpath (exact paths confirmed on macOS):\n  /Applications/WorkdayStudio/Eclipse.app/Contents/Eclipse/plugins/com.workday.wtp.cloud.runtime.a_2025.24.132/lib/httpclient-4.2.3.jar\n  /Applications/WorkdayStudio/Eclipse.app/Contents/Eclipse/plugins/com.workday.wtp.cloud.runtime.a_2025.24.132/lib/httpcore-4.2.2.jar\n  /Applications/WorkdayStudio/Eclipse.app/Contents/Eclipse/plugins/com.workday.wtp.cloud.runtime.a_2025.24.132/lib/commons-logging-1.1.1.jar\n\nUsing CloseableHttpClient or HttpClients.custom() will compile in your IDE but fail at deploy time with NoSuchMethodError.\n\nPROJECT STRUCTURE for Java beans:\n  project/\n    src/main/java/com/example/integration/MyBean.java   ← source\n    build/classes/                                     ← Eclipse output (auto-compiled)\n    ws/WSAR-INF/assembly.xml\n    .classpath     ← includes src/main/java + the 3 HttpClient JARs above\n    .project       ← includes org.eclipse.jdt.core.javabuilder\n\nCANONICAL USE CASE (DayforceUrlResolverComponent): train.dayforcehcm.com returns HTTP 302 redirect to cantrainNNN.dayforcehcm.com. Studio cc:http-basic-auth drops credentials on redirect → 401. The bean runs once at integration init, follows the redirect with preemptive auth (LaxRedirectStrategy + manual Authorization header), captures the final hostname, and stores it as the resolved base URL. Subsequent per-record cc:http-out calls hit the resolved URL directly — no redirect, auth works.\n\nThree traps that wasted debugging sessions on the Dayforce probe:\n1. HEAD requests don\'t trigger the 302 — Dayforce only redirects GET. Use HttpGet.\n2. Unauthenticated GET also doesn\'t redirect — must include Authorization: Basic on the probe.\n3. Base URL alone returns HTTP 400 with no redirect — only real endpoints (e.g. /Employees) trigger the 302. Probe URL must be baseUrl + a real endpoint path.',
    routes_via: 'parent steps continuation',
    xml_example: `<!-- Pattern A: @Component bean called as a step -->
<cc:async-mediation id="DoResolveUrl" routes-to="EndResolveUrl">
  <cc:steps>
    <cc:custom id="ResolveUrl" ref="DayforceUrlResolver"/>
  </cc:steps>
</cc:async-mediation>

<!-- Spring bean declaration — outside cc:assembly, inside the <beans> root -->
<bean id="DayforceUrlResolver"
      class="com.example.integration.DayforceUrlResolverComponent"
      scope="prototype"/>

<!-- Pattern B: Plain POJO called via MVEL — no cc:custom step needed -->
<bean id="dateHelper"
      class="com.example.integration.DateHelper"
      scope="prototype"/>

<cc:async-mediation id="DoFormatDate" routes-to="Continue">
  <cc:steps>
    <cc:eval id="FormatHireDate">
      <cc:expression>props['hire.formatted'] = dateHelper.toIso(props['hire.date'])</cc:expression>
    </cc:eval>
  </cc:steps>
</cc:async-mediation>`,
  },
  'json-splitter': {
    description: 'Splits a raw JSON message on a JSONPath expression without first converting it to XML. Each matched element becomes a separate message routed through the sub-route. Use when you want to iterate over a JSON array returned directly from an API, before or instead of cc:json-to-xml.\n\nUsed as the split strategy child inside cc:splitter, alongside cc:sub-route.\n\nKEY ATTRIBUTE:\n- json-path — JSONPath expression selecting the array to split on. E.g. "$.attachments" selects the top-level "attachments" array.\n\nCONTRAST WITH cc:xml-stream-splitter / cc:xpath-splitter:\n- cc:json-splitter — works on raw JSON, no prior conversion needed\n- cc:xml-stream-splitter — streaming XML split (large docs)\n- cc:xpath-splitter — in-memory XML split (small docs; often used after cc:json-to-xml)\n\nTypical pipeline: http-out GET → json-splitter($.arrayField) → per-record async-mediation → json-to-xml → eval (extract fields) → downstream processing',
    routes_via: 'sub-route routes-to (per element)',
    xml_example: `<!-- Split raw JSON on $.attachments array (Greenhouse attachments pattern)
  Prior step: cc:http-out GET to a Greenhouse API endpoint returns a JSON body
  like: {"id": 123, "attachments": [{...}, {...}]} -->

<cc:splitter id="SplitAttachments">
  <cc:sub-route name="SubRoute" routes-to="ProcessAttachment"/>
  <cc:json-splitter json-path="$.attachments"/>
</cc:splitter>

<!-- Each split message is one JSON attachment object.
     Inside ProcessAttachment: convert to XML to use XPath. -->
<cc:async-mediation id="ProcessAttachment" routes-to="Aggregator">
  <cc:steps>
    <!-- Now convert the single JSON record to XML for XPath -->
    <cc:json-to-xml id="JsonToXml" nested-object-name="record"/>
    <cc:eval id="ExtractUrl">
      <cc:expression>props['attachment_url'] = parts[0].xpath('root/record/url')</cc:expression>
      <cc:expression>props['attachment_type'] = parts[0].xpath('root/record/type')</cc:expression>
    </cc:eval>
    <!-- Fetch and process the attachment -->
    <cc:xslt-plus id="MapAttachment" output-mimetype="text/xml" url="MapAttachment.xsl"/>
  </cc:steps>
</cc:async-mediation>

<!-- Compare: split after cc:json-to-xml has converted to XML (xpath-splitter) -->
<cc:splitter id="SplitEntries">
  <cc:sub-route name="SubRoute" routes-to="ProcessEntry"/>
  <cc:xpath-splitter xpath="root/entry"/>
</cc:splitter>`,
  },
};

export function register(server) {
  server.tool(
    'get_step_type_reference',
    'Returns documentation and XML examples for Workday Studio assembly step types. Use this before writing or modifying assembly.xml to get the correct XML schema for each step type.',
    {
      step_type: z.string().optional().describe('Specific step type to look up (e.g. "transform", "http-out", "splitter"). Omit to get the full reference.'),
    },
    async ({ step_type }) => {
      if (step_type) {
        const entry = REFERENCE[step_type];
        if (!entry) {
          const known = Object.keys(REFERENCE).join(', ');
          return errorResponse('UNKNOWN_STEP_TYPE', `Unknown step type: '${step_type}'.`, `Known types: ${known}`);
        }
        return { content: [{ type: 'text', text: JSON.stringify({ [step_type]: entry }, null, 2) }] };
      }

      // Return summary of all types
      const summary = Object.entries(REFERENCE).map(([type, info]) => ({
        type: `cc:${type}`,
        description: info.description,
        routes_via: info.routes_via,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
  );
}

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
