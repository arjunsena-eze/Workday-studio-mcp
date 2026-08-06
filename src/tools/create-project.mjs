import { z } from 'zod';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { config } from '../config.mjs';

export function register(server) {
  server.tool(
    'create_studio_project',
    'Scaffold a new empty Workday Studio integration project in the Eclipse workspace. Creates the full project directory structure (.project, .classpath, .settings/, ws/WSAR-INF/) with a blank assembly.xml ready to open in Studio.',
    {
      project_name: z.string().describe('The project name (e.g. INT145_My_New_Integration). Used as the Eclipse project name and integration system name.'),
    },
    async ({ project_name }) => {
      const projectPath = resolve(config.workspacePath, project_name);

      if (existsSync(projectPath)) {
        return errorResponse('PROJECT_EXISTS', `Project '${project_name}' already exists.`, 'Choose a different name or use list_studio_projects to see existing projects.');
      }

      try {
        await createProjectScaffold(projectPath, project_name);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              project_name,
              path: projectPath,
              files_created: [
                '.project',
                '.classpath',
                '.settings/cc.facet.assembly.xml',
                '.settings/cc.ws.cloud.assembly.xml',
                '.settings/org.eclipse.core.resources.prefs',
                '.settings/org.eclipse.jdt.core.prefs',
                '.settings/org.eclipse.wst.common.component',
                '.settings/org.eclipse.wst.common.project.facet.core.xml',
                'ws/META-INF/MANIFEST.MF',
                'ws/WSAR-INF/assembly.xml',
                'ws/WSAR-INF/assembly-diagram.xml',
              ],
              next_steps: 'Import into Eclipse: File → Import → Existing Projects into Workspace. The assembly includes a scaffolded GlobalErrorHandler (routes to DeliverError). Studio renders it automatically as a floating indicator — no diagram entry needed.',
            }, null, 2),
          }],
        };
      } catch (e) {
        return errorResponse('CREATE_FAILED', e.message, null);
      }
    }
  );
}

async function createProjectScaffold(projectPath, projectName) {
  await mkdir(join(projectPath, '.settings'), { recursive: true });
  await mkdir(join(projectPath, 'build', 'classes'), { recursive: true });
  await mkdir(join(projectPath, 'src', 'main', 'java'), { recursive: true });
  await mkdir(join(projectPath, 'ws', 'WSAR-INF'), { recursive: true });
  await mkdir(join(projectPath, 'ws', 'META-INF'), { recursive: true });

  await writeFile(join(projectPath, '.project'), dotProject(projectName));
  await writeFile(join(projectPath, '.classpath'), CLASSPATH);
  await writeFile(join(projectPath, '.settings', 'cc.facet.assembly.xml'), CC_FACET_ASSEMBLY);
  await writeFile(join(projectPath, '.settings', 'cc.ws.cloud.assembly.xml'), ccWsCloudAssembly(projectName));
  await writeFile(join(projectPath, '.settings', 'org.eclipse.core.resources.prefs'), CORE_RESOURCES_PREFS);
  await writeFile(join(projectPath, '.settings', 'org.eclipse.jdt.core.prefs'), JDT_CORE_PREFS);
  await writeFile(join(projectPath, '.settings', 'org.eclipse.wst.common.component'), wstCommonComponent(projectName));
  await writeFile(join(projectPath, '.settings', 'org.eclipse.wst.common.project.facet.core.xml'), FACET_CORE);
  await writeFile(join(projectPath, 'ws', 'META-INF', 'MANIFEST.MF'), MANIFEST_MF);
  await writeFile(join(projectPath, 'ws', 'WSAR-INF', 'assembly.xml'), assemblyXml(projectName));
  await writeFile(join(projectPath, 'ws', 'WSAR-INF', 'assembly-diagram.xml'), ASSEMBLY_DIAGRAM);
}

// --- templates ---

// Every hand-built Studio project carries this. Studio's WSAR packaging expects
// ws/META-INF/MANIFEST.MF to exist; a project scaffolded without it diverges from
// what Studio itself produces. CRLF line endings and the trailing space after
// "Class-Path:" match the file Studio writes — the JAR manifest format is
// whitespace-sensitive, so do not "tidy" this string.
const MANIFEST_MF = 'Manifest-Version: 1.0\r\nClass-Path: \r\n\r\n';

function dotProject(name) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
\t<name>${name}</name>
\t<comment></comment>
\t<projects>
\t</projects>
\t<buildSpec>
\t\t<buildCommand>
\t\t\t<name>com.capeclear.wtp.facet.assembly.builder</name>
\t\t\t<arguments>
\t\t\t</arguments>
\t\t</buildCommand>
\t\t<buildCommand>
\t\t\t<name>org.eclipse.jdt.core.javabuilder</name>
\t\t\t<arguments>
\t\t\t</arguments>
\t\t</buildCommand>
\t\t<buildCommand>
\t\t\t<name>com.workday.wtp.ws.cloud.assembly.builder</name>
\t\t\t<arguments>
\t\t\t</arguments>
\t\t</buildCommand>
\t\t<buildCommand>
\t\t\t<name>org.eclipse.wst.common.project.facet.core.builder</name>
\t\t\t<arguments>
\t\t\t</arguments>
\t\t</buildCommand>
\t\t<buildCommand>
\t\t\t<name>org.eclipse.wst.validation.validationbuilder</name>
\t\t\t<arguments>
\t\t\t</arguments>
\t\t</buildCommand>
\t</buildSpec>
\t<natures>
\t\t<nature>org.eclipse.jem.workbench.JavaEMFNature</nature>
\t\t<nature>org.eclipse.wst.common.modulecore.ModuleCoreNature</nature>
\t\t<nature>org.eclipse.wst.common.project.facet.core.nature</nature>
\t\t<nature>com.workday.wtp.ws.cloud.assembly.nature</nature>
\t\t<nature>org.eclipse.jdt.core.javanature</nature>
\t\t<nature>com.capeclear.wtp.facet.assembly.nature</nature>
\t</natures>
</projectDescription>`;
}

const CLASSPATH = `<?xml version="1.0" encoding="UTF-8"?>
<classpath>
\t<classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER/org.eclipse.jdt.internal.debug.ui.launcher.StandardVMType/JavaSE-1.8"/>
\t<classpathentry kind="src" path="src/main/java"/>
\t<classpathentry kind="con" path="com.capeclear.wtp.ws.container">
\t\t<attributes>
\t\t\t<attribute name="org.eclipse.jst.component.nondependency" value=""/>
\t\t</attributes>
\t</classpathentry>
\t<classpathentry kind="con" path="org.eclipse.jst.server.core.container/com.workday.cloud.jst.server.runtimeTarget.wdscl/Workday Runtime">
\t\t<attributes>
\t\t\t<attribute name="owner.project.facets" value="cc.ws.cloud.assembly"/>
\t\t</attributes>
\t</classpathentry>
\t<classpathentry kind="output" path="build/classes"/>
</classpath>`;

const CC_FACET_ASSEMBLY = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<model modelId="com.capeclear.wtp.facet.assembly.facet.AssemblyFacetInstallDataModelProvider">
    <map key="IAssemblyFacetInstallDataModelProperties.LINK_URI_LIST"/>
    <list key="ICcFacetInstallDataModelProperties.EXCLUDE_FROM_DEPLOY_SRC"/>
    <value class="java.lang.Boolean" key="ICcFacetInstallDataModelProperties.MARK_GENERATED_DERIVED">true</value>
    <value class="java.lang.Boolean" key="ICcFacetInstallDataModelProperties.USE_CLASSPATH_DEPENDENCY_FOR_PARENT_SERVICE">true</value>
    <value class="java.lang.String" key="ICcFacetInstallDataModelProperties.WS_FOLDER">ws</value>
    <value class="java.lang.Boolean" key="ICcFacetInstallDataModelProperties.COPY_WSDL_FILES_ON_DEPLOY">true</value>
    <value class="java.lang.String" key="IAssemblyFacetInstallDataModelProperties.ASSEMBLY_TEMPLATE_ID">assembly</value>
    <value class="java.lang.Boolean" key="ICcFacetInstallDataModelProperties.EXPORT_REFERENCED_WEBSERVICE_PROJECT_CLASSPATH">false</value>
</model>`;

function ccWsCloudAssembly(name) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<model modelId="com.workday.wtp.ws.cloud.assembly.facet.WsCloudAssemblyFacetInstallDataModelProvider">
    <value class="java.lang.String" key="ICcFacetInstallDataModelProperties.MODULE_SERVICE_TOKENIZED_NAME">@PROJECT_NAME@</value>
    <list key="ICcFacetInstallDataModelProperties.EXCLUDE_FROM_DEPLOY_SRC"/>
    <value class="java.lang.String" key="IWsCloudAssemblyFacetInstallDataModelProperties.WD_INTEGRATION_TYPE">regular.e2</value>
    <value class="java.lang.Boolean" key="ICcFacetInstallDataModelProperties.MARK_GENERATED_DERIVED">true</value>
    <value class="java.lang.Boolean" key="ICcFacetInstallDataModelProperties.MODULE_SERVICE_NAME_PROJECT">true</value>
    <value class="java.lang.Boolean" key="ICcFacetInstallDataModelProperties.USE_CLASSPATH_DEPENDENCY_FOR_PARENT_SERVICE">true</value>
    <value class="java.lang.String" key="ICcFacetInstallDataModelProperties.MODULE_SERVICE_NAME"/>
    <value class="java.lang.String" key="ICcFacetInstallDataModelProperties.WS_FOLDER">ws</value>
    <value class="java.lang.Boolean" key="ICcFacetInstallDataModelProperties.COPY_WSDL_FILES_ON_DEPLOY">true</value>
    <value class="java.lang.Boolean" key="ICcFacetInstallDataModelProperties.MODULE_SERVICE_NAME_CUSTOM">false</value>
    <list key="IWsCloudAssemblyFacetInstallDataModelProperties.MEMBER_OF_CLOUD_COLLECTIONS">
        <value class="java.lang.String">${name}</value>
    </list>
    <value class="java.lang.Boolean" key="ICcFacetInstallDataModelProperties.MODULE_SERVICE_NAME_VERSION">false</value>
    <value class="java.lang.Boolean" key="ICcFacetInstallDataModelProperties.EXPORT_REFERENCED_WEBSERVICE_PROJECT_CLASSPATH">false</value>
</model>`;
}

const CORE_RESOURCES_PREFS = `eclipse.preferences.version=1
encoding/<project>=UTF-8`;

const JDT_CORE_PREFS = `eclipse.preferences.version=1
org.eclipse.jdt.core.compiler.codegen.inlineJsrBytecode=enabled
org.eclipse.jdt.core.compiler.codegen.targetPlatform=1.8
org.eclipse.jdt.core.compiler.compliance=1.8
org.eclipse.jdt.core.compiler.problem.assertIdentifier=error
org.eclipse.jdt.core.compiler.problem.enumIdentifier=error
org.eclipse.jdt.core.compiler.source=1.8`;

function wstCommonComponent(name) {
  return `<?xml version="1.0" encoding="UTF-8"?><project-modules id="moduleCoreId" project-version="1.5.0">

    <wb-module deploy-name="${name}">

        <wb-resource deploy-path="/" source-path="/ws"/>

    </wb-module>

</project-modules>`;
}

const FACET_CORE = `<?xml version="1.0" encoding="UTF-8"?>
<faceted-project>
  <runtime name="Workday Runtime"/>
  <fixed facet="java"/>
  <fixed facet="cc.facet.assembly"/>
  <fixed facet="cc.ws.cloud.assembly"/>
  <installed facet="cc.ws.cloud.assembly" version="1.0"/>
  <installed facet="java" version="1.8"/>
  <installed facet="cc.facet.assembly" version="1.0"/>
</faceted-project>`;

function assemblyXml(name) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<beans
     xmlns="http://www.springframework.org/schema/beans"
     xmlns:beans="http://www.springframework.org/schema/beans"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:cc="http://www.capeclear.com/assembly/10"
     xmlns:cloud="urn:com.workday/esb/cloud/10.0"
     xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"
     xmlns:pi="urn:com.workday/picof"
     xmlns:wd="urn:com.workday/bsvc"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">

\t<cc:assembly id="WorkdayAssembly" version="2024.37">

\t\t<!-- Entry point -->
\t\t<cc:workday-in id="StartHere" routes-to="End">
\t\t\t<cc:integration-system name="${name}">
\t\t\t</cc:integration-system>
\t\t</cc:workday-in>

\t\t<!-- TODO: Add integration steps here -->

\t\t<cc:note id="End">
\t\t\t<cc:description>Integration complete.</cc:description>
\t\t</cc:note>

\t\t<!-- Global error handler: any unhandled error is posted to the integration event.
\t\t     cc:send-error appears as a floating indicator above the diagram (Studio behavior).
\t\t     DeliverError (cc:local-out) is the visible endpoint rendered in the Error Handler swimlane. -->
\t\t<cc:send-error id="GlobalErrorHandler" routes-to="DeliverError" rethrow-error="false"/>

\t\t<cc:local-out id="DeliverError" store-message="none" endpoint="vm://wcc/PutIntegrationMessage">
\t\t\t<cc:set name="is.message.severity"     value="'ERROR'"/>
\t\t\t<cc:set name="is.message.summary"      value="'${name} failed: ' + context.errorMessage"/>
\t\t\t<cc:set name="is.document.deliverable" value="'false'"/>
\t\t</cc:local-out>

\t</cc:assembly>

</beans>`;
}

// GlobalErrorHandler EMF XPath for the scaffold template.
// The assemblyXml() template has these children inside <cc:assembly> (0-based @mixed index):
//   0=text  1=comment(Entry point)  2=text  3=workday-in(StartHere)
//   4=text  5=comment(TODO)         6=text  7=note(End)
//   8=text  9=comment(Global error handler) 10=text  11=send-error(GlobalErrorHandler)
//   12=text 13=local-out(DeliverError)
// So GlobalErrorHandler = //@beans/@mixed.1/@mixed.11
const SCAFFOLD_GLOBAL_ERROR_HANDLER_PATH = 'assembly.xml#//@beans/@mixed.1/@mixed.11';

const ASSEMBLY_DIAGRAM = `<?xml version="1.0" encoding="UTF-8"?>
<wdnm:Diagram xmlns:wdnm="http://workday.com/studio/editors/notation">
  <element href="assembly.xml#WorkdayAssembly"/>

  <visualProperties x="80" y="200">
    <element href="assembly.xml#StartHere"/>
  </visualProperties>
  <visualProperties x="300" y="200">
    <element href="assembly.xml#End"/>
  </visualProperties>
  <visualProperties>
    <element href="${SCAFFOLD_GLOBAL_ERROR_HANDLER_PATH}"/>
  </visualProperties>
  <visualProperties x="300" y="80">
    <element href="assembly.xml#DeliverError"/>
  </visualProperties>

  <connections type="routesTo">
    <source href="assembly.xml#StartHere"/>
    <target href="assembly.xml#End"/>
  </connections>
  <connections type="routesTo">
    <source href="${SCAFFOLD_GLOBAL_ERROR_HANDLER_PATH}"/>
    <target href="assembly.xml#DeliverError"/>
  </connections>

  <swimlanes x="30" y="140" name="Integration Flow" alignment="END" labelAlignment="LEFT">
    <elements href="assembly.xml#StartHere"/>
    <elements href="assembly.xml#End"/>
  </swimlanes>

  <swimlanes x="30" y="30" name="Error Handler" alignment="END" labelAlignment="LEFT">
    <elements href="${SCAFFOLD_GLOBAL_ERROR_HANDLER_PATH}"/>
    <elements href="assembly.xml#DeliverError"/>
  </swimlanes>

</wdnm:Diagram>`;

function errorResponse(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }) }] };
}
