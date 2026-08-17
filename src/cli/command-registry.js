import { createReadonlyMap, defineCommand } from '../domain/command-definition.js';

const string = (name, aliases, extras = {}) => ({ name, aliases, type: 'string', ...extras });
const number = (name, aliases, extras = {}) => ({ name, aliases, type: 'number', ...extras });
const json = (name, aliases, extras = {}) => ({ name, aliases, type: 'json', ...extras });
const jsonOrPath = (name, aliases, extras = {}) => ({ name, aliases, type: 'jsonOrPath', ...extras });
const boolean = (name, aliases, extras = {}) => ({ name, aliases, type: 'boolean', ...extras });

const sassLogLevel = () =>
  string('sassLogLevel', ['--sassLogLevel'], {
    defaultValue: 'warn',
    required: false,
    choices: ['verbose', 'warn', 'error']
  });

const componentCreateOptions = () => [
  boolean('e2e', ['--e2e'], { defaultValue: false, required: false }),
  jsonOrPath('scaffold', ['-s', '--scaffold'], { required: false }),
  boolean('installDeps', ['--install-deps'], { defaultValue: false, required: false })
];

const componentDevOptions = () => [
  number('port', ['-p', '--port'], { defaultValue: 8001, required: false }),
  boolean('open', ['-o', '--open'], { defaultValue: true, required: false }),
  string('host', ['--host'], { defaultValue: '127.0.0.1', required: false }),
  boolean('strictPort', ['--strictPort'], { defaultValue: false, required: false }),
  sassLogLevel()
];

const componentDocumentationOptions = () => [
  string('mdFile', ['--mdFile'], { defaultValue: 'README.md', required: false }),
  boolean('noMd', ['--noMd'], { defaultValue: false, required: false })
];

const componentLintOptions = () => [
  boolean('fix', ['--fix'], { defaultValue: false, required: false }),
  boolean('abortOnFailure', ['--abortOnFailure'], { defaultValue: false, required: false })
];

const componentTestOptions = () => [
  boolean('wtr', ['--wtr'], { defaultValue: false, required: false }),
  boolean('watch', ['-w', '--watch'], { defaultValue: false, required: false }),
  boolean('updateSnapshots', ['--updateSnapshots'], { defaultValue: false, required: false }),
  boolean('updateLocales', ['--updateLocales'], { defaultValue: false, required: false }),
  boolean('coverage', ['--coverage'], { defaultValue: false, required: false }),
  number('wtrTestsFinishTimeout', ['--wtrTestsFinishTimeout'], { defaultValue: 120000, required: false })
];

const command = (name, summaryKey, options = [], requiresWorkspace = true) =>
  defineCommand({ name, summaryKey, options, requiresWorkspace, execute: null });

/**
 * Returns the complete, immutable Academy command grammar. Command handlers
 * are intentionally absent until their own task supplies a use case.
 *
 * @returns {ReadonlyMap<string, Readonly<object>>}
 */
export function createCommandRegistry() {
  return createReadonlyMap([
    [
      'app:build',
      command('app:build', 'command_app_build', [
        string('config', ['-c', '--config'], { required: true }),
        sassLogLevel(),
        boolean('sourceMap', ['--sourceMap'], { defaultValue: false, required: false })
      ])
    ],
    [
      'app:changelog',
      command('app:changelog', 'command_app_changelog', [
        string('preset', ['-p', '--preset'], { defaultValue: 'angular', required: false }),
        boolean('full', ['-f', '--full'], { defaultValue: false, required: false }),
        string('name', ['-n', '--name'], { defaultValue: 'CHANGELOG.md', required: false })
      ])
    ],
    ['app:create', command('app:create', 'command_app_create', [jsonOrPath('scaffold', ['-s', '--scaffold'], { required: false })], false)],
    [
      'app:dev',
      command('app:dev', 'command_app_dev', [
        string('config', ['-c', '--config'], { required: true }),
        string('host', ['--host'], { defaultValue: '127.0.0.1', required: false }),
        number('port', ['-p', '--port'], { defaultValue: 8001, required: false }),
        boolean('open', ['-o', '--open'], { defaultValue: true, required: false }),
        sassLogLevel(),
        boolean('debug', ['-d', '--debug'], { defaultValue: false, required: false }),
        boolean('clearScreen', ['--clearScreen'], { defaultValue: false, required: false }),
        boolean('strictPort', ['--strictPort'], { defaultValue: false, required: false })
      ])
    ],
    ['app:install', command('app:install', 'command_app_install', [boolean('ci', ['--ci'], { defaultValue: false, required: false })])],
    [
      'app:lint',
      command('app:lint', 'command_app_lint', [
        boolean('fix', ['--fix'], { defaultValue: false, required: false }),
        boolean('abortOnFailure', ['--abortOnFailure'], { defaultValue: false, required: false })
      ])
    ],
    ['app:locales', command('app:locales', 'command_app_locales', [string('config', ['-c', '--config'], { required: true })])],
    [
      'app:preview',
      command('app:preview', 'command_app_preview', [
        string('config', ['-c', '--config'], { required: true }),
        string('host', ['--host'], { defaultValue: '127.0.0.1', required: false }),
        number('port', ['-p', '--port'], { defaultValue: 8001, required: false }),
        boolean('open', ['-o', '--open'], { defaultValue: true, required: false }),
        boolean('strictPort', ['--strictPort'], { defaultValue: false, required: false })
      ])
    ],
    [
      'app:test',
      command('app:test', 'command_app_test', [
        boolean('wtr', ['--wtr'], { defaultValue: false, required: false }),
        boolean('watch', ['-w', '--watch'], { defaultValue: false, required: false }),
        boolean('updateSnapshots', ['--updateSnapshots'], { defaultValue: false, required: false }),
        number('wtrTestsFinishTimeout', ['--wtrTestsFinishTimeout'], { defaultValue: 120000, required: false }),
        boolean('updateLocales', ['--updateLocales'], { defaultValue: false, required: false }),
        boolean('coverage', ['--coverage'], { defaultValue: false, required: false }),
        string('config', ['-c', '--config'], { required: false })
      ])
    ],
    [
      'component:build:demo',
      command('component:build:demo', 'command_component_build_demo', [
        string('dist', ['-d', '--dist'], { defaultValue: 'dist', required: false }),
        string('demo', ['--demo'], { defaultValue: 'demo', required: false }),
        boolean('verbose', ['-v', '--verbose'], { defaultValue: true, required: false })
      ])
    ],
    [
      'component:changelog',
      command('component:changelog', 'command_component_changelog', [
        string('preset', ['-p', '--preset'], { defaultValue: 'angular', required: false }),
        boolean('full', ['-f', '--full'], { defaultValue: false, required: false }),
        string('name', ['-n', '--name'], { defaultValue: 'CHANGELOG.md', required: false })
      ])
    ],
    [
      'component:create',
      command('component:create', 'command_component_create', componentCreateOptions(), false)
    ],
    [
      'component:dev',
      command('component:dev', 'command_component_dev', componentDevOptions())
    ],
    [
      'component:documentation',
      command('component:documentation', 'command_component_documentation', componentDocumentationOptions())
    ],
    ['component:install', command('component:install', 'command_component_install', [boolean('ci', ['--ci'], { defaultValue: false, required: false })])],
    [
      'component:lint',
      command('component:lint', 'command_component_lint', componentLintOptions())
    ],
    ['component:locales', command('component:locales', 'command_component_locales')],
    ['component:sass', command('component:sass', 'command_component_sass', [sassLogLevel()])],
    [
      'component:serve',
      command('component:serve', 'command_component_dev', componentDevOptions())
    ],
    [
      'component:test',
      command('component:test', 'command_component_test', componentTestOptions())
    ],
    [
      'lit-component:create',
      command('lit-component:create', 'command_component_create', componentCreateOptions(), false)
    ],
    [
      'lit-component:documentation',
      command('lit-component:documentation', 'command_component_documentation', componentDocumentationOptions())
    ],
    [
      'lit-component:lint',
      command('lit-component:lint', 'command_component_lint', componentLintOptions())
    ],
    ['lit-component:locales', command('lit-component:locales', 'command_component_locales')],
    [
      'lit-component:serve',
      command('lit-component:serve', 'command_component_dev', componentDevOptions())
    ],
    [
      'lit-component:test',
      command('lit-component:test', 'command_component_test', componentTestOptions())
    ]
  ]);
}
