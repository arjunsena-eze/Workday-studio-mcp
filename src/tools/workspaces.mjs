import { z } from 'zod';
import { config, setActiveWorkspace } from '../config.mjs';

/**
 * Named workspace profiles, for serving several engagements from one clone —
 * your own workspace plus a client's project dropped in for a fix.
 *
 * Two tools rather than one so that reading is unmistakably read-only: an agent
 * orienting itself calls list_workspaces freely, and switching is a separate,
 * deliberate act.
 */

export function register(server) {
  server.tool(
    'list_workspaces',
    [
      'Lists the configured Studio workspace profiles and shows which is active.',
      '',
      'CALL THIS FIRST when a session involves more than one workspace — a client project',
      'alongside your own, or any request that names a client. Every read and write tool',
      'resolves paths against the ACTIVE workspace, so confirming which one is active before',
      'editing is what stops an edit landing in the wrong client\'s project.',
      '',
      'Read-only. Use set_active_workspace to switch.',
    ].join('\n'),
    {},
    async () => {
      const rows = Object.entries(config.workspaces).map(([name, { path, exists }]) => ({
        name,
        path,
        active: name === config.activeWorkspace,
        ...(exists ? {} : { missing: true }),
      }));

      return ok({
        active_workspace: config.activeWorkspace,
        active_path: config.workspacePath,
        profiles: rows,
        ...(rows.length <= 1 && {
          hint: 'Only one profile is configured. Add more under "workspaces" in config.json: '
            + '{ "workspaces": { "default": "C:\\\\Users\\\\me\\\\workspace", "clientA": "D:\\\\clients\\\\A\\\\workspace" }, '
            + '"active_workspace": "default" }',
        }),
      });
    },
  );

  server.tool(
    'set_active_workspace',
    [
      'Switches the active Studio workspace to a named profile for the rest of this session.',
      '',
      'Every subsequent read and write resolves against the new path, so treat this as a',
      'context switch: finish or checkpoint work in the current workspace first, and say',
      'which workspace you are in when you report back.',
      '',
      'The profile must already exist in config.json — this cannot invent a path. Run',
      'list_workspaces to see the options. The change lasts until the server restarts; it',
      'does not rewrite config.json.',
    ].join('\n'),
    {
      name: z.string().describe('Profile name from list_workspaces, e.g. "default" or "clientA"'),
    },
    async ({ name }) => {
      const result = setActiveWorkspace(name);
      if (!result.ok) {
        return err('UNKNOWN_WORKSPACE', result.error,
          result.known
            ? `Configured profiles: ${result.known.join(', ')}. Add new ones under "workspaces" in config.json.`
            : 'Fix the path in config.json.');
      }
      return ok({
        switched: true,
        previous: result.previous,
        active_workspace: result.active,
        active_path: result.path,
        reminder: 'All file tools now resolve against this workspace. State which workspace you are '
          + 'working in when reporting results.',
      });
    },
  );
}

function ok(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function err(code, message, suggestion) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: true, code, message, suggestion }, null, 2) }] };
}
