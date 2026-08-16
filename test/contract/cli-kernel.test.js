import assert from 'node:assert/strict';
import test from 'node:test';

import { createCommandRegistry } from '../../src/cli/command-registry.js';
import { parseArgv } from '../../src/cli/parse-argv.js';
import { renderHelp } from '../../src/cli/render-help.js';
import { renderOutcome } from '../../src/cli/render-outcome.js';
import { createReadonlyMap, defineCommand } from '../../src/domain/command-definition.js';
import { fail, ok } from '../../src/domain/outcome.js';
import { translate } from '../../src/i18n/translator.js';

const COMMAND_CONTRACTS = [
  {
    name: 'app:build',
    options: [
      { name: 'config', aliases: ['-c', '--config'], type: 'string', required: true },
      {
        name: 'sassLogLevel',
        aliases: ['--sassLogLevel'],
        type: 'string',
        defaultValue: 'warn',
        required: false,
        choices: ['verbose', 'warn', 'error']
      },
      {
        name: 'sourceMap',
        aliases: ['--sourceMap'],
        type: 'boolean',
        defaultValue: false,
        required: false
      }
    ]
  },
  {
    name: 'app:changelog',
    options: [
      { name: 'preset', aliases: ['-p', '--preset'], type: 'string', defaultValue: 'angular', required: false },
      { name: 'full', aliases: ['-f', '--full'], type: 'boolean', defaultValue: false, required: false },
      {
        name: 'name',
        aliases: ['-n', '--name'],
        type: 'string',
        defaultValue: 'CHANGELOG.md',
        required: false
      }
    ]
  },
  {
    name: 'app:create',
    options: [{ name: 'scaffold', aliases: ['-s', '--scaffold'], type: 'jsonOrPath', required: false }]
  },
  {
    name: 'app:dev',
    options: [
      { name: 'config', aliases: ['-c', '--config'], type: 'string', required: true },
      { name: 'host', aliases: ['--host'], type: 'string', defaultValue: '127.0.0.1', required: false },
      { name: 'port', aliases: ['-p', '--port'], type: 'number', defaultValue: 8001, required: false },
      { name: 'open', aliases: ['-o', '--open'], type: 'boolean', defaultValue: true, required: false },
      {
        name: 'sassLogLevel',
        aliases: ['--sassLogLevel'],
        type: 'string',
        defaultValue: 'warn',
        required: false,
        choices: ['verbose', 'warn', 'error']
      },
      { name: 'debug', aliases: ['-d', '--debug'], type: 'boolean', defaultValue: false, required: false },
      {
        name: 'clearScreen',
        aliases: ['--clearScreen'],
        type: 'boolean',
        defaultValue: false,
        required: false
      },
      {
        name: 'strictPort',
        aliases: ['--strictPort'],
        type: 'boolean',
        defaultValue: false,
        required: false
      }
    ]
  },
  {
    name: 'app:install',
    options: [{ name: 'ci', aliases: ['--ci'], type: 'boolean', defaultValue: false, required: false }]
  },
  {
    name: 'app:lint',
    options: [
      { name: 'fix', aliases: ['--fix'], type: 'boolean', defaultValue: false, required: false },
      {
        name: 'abortOnFailure',
        aliases: ['--abortOnFailure'],
        type: 'boolean',
        defaultValue: false,
        required: false
      }
    ]
  },
  {
    name: 'app:locales',
    options: [{ name: 'config', aliases: ['-c', '--config'], type: 'string', required: true }]
  },
  {
    name: 'app:preview',
    options: [
      { name: 'config', aliases: ['-c', '--config'], type: 'string', required: true },
      { name: 'host', aliases: ['--host'], type: 'string', defaultValue: '127.0.0.1', required: false },
      { name: 'port', aliases: ['-p', '--port'], type: 'number', defaultValue: 8001, required: false },
      { name: 'open', aliases: ['-o', '--open'], type: 'boolean', defaultValue: true, required: false },
      {
        name: 'strictPort',
        aliases: ['--strictPort'],
        type: 'boolean',
        defaultValue: false,
        required: false
      }
    ]
  },
  {
    name: 'app:test',
    options: [
      { name: 'wtr', aliases: ['--wtr'], type: 'boolean', defaultValue: false, required: false },
      { name: 'watch', aliases: ['-w', '--watch'], type: 'boolean', defaultValue: false, required: false },
      {
        name: 'updateSnapshots',
        aliases: ['--updateSnapshots'],
        type: 'boolean',
        defaultValue: false,
        required: false
      },
      {
        name: 'wtrTestsFinishTimeout',
        aliases: ['--wtrTestsFinishTimeout'],
        type: 'number',
        defaultValue: 120000,
        required: false
      },
      {
        name: 'updateLocales',
        aliases: ['--updateLocales'],
        type: 'boolean',
        defaultValue: false,
        required: false
      },
      { name: 'coverage', aliases: ['--coverage'], type: 'boolean', defaultValue: false, required: false },
      { name: 'config', aliases: ['-c', '--config'], type: 'string', required: false }
    ]
  },
  {
    name: 'component:build:demo',
    options: [
      { name: 'dist', aliases: ['-d', '--dist'], type: 'string', defaultValue: 'dist', required: false },
      { name: 'demo', aliases: ['--demo'], type: 'string', defaultValue: 'demo', required: false },
      { name: 'verbose', aliases: ['-v', '--verbose'], type: 'boolean', defaultValue: true, required: false }
    ]
  },
  {
    name: 'component:changelog',
    options: [
      { name: 'preset', aliases: ['-p', '--preset'], type: 'string', defaultValue: 'angular', required: false },
      { name: 'full', aliases: ['-f', '--full'], type: 'boolean', defaultValue: false, required: false },
      {
        name: 'name',
        aliases: ['-n', '--name'],
        type: 'string',
        defaultValue: 'CHANGELOG.md',
        required: false
      }
    ]
  },
  {
    name: 'component:create',
    options: [
      { name: 'e2e', aliases: ['--e2e'], type: 'boolean', defaultValue: false, required: false },
      { name: 'scaffold', aliases: ['-s', '--scaffold'], type: 'jsonOrPath', required: false },
      {
        name: 'installDeps',
        aliases: ['--install-deps'],
        type: 'boolean',
        defaultValue: false,
        required: false
      }
    ]
  },
  {
    name: 'component:dev',
    options: [
      { name: 'port', aliases: ['-p', '--port'], type: 'number', defaultValue: 8001, required: false },
      { name: 'open', aliases: ['-o', '--open'], type: 'boolean', defaultValue: true, required: false },
      { name: 'host', aliases: ['--host'], type: 'string', defaultValue: '127.0.0.1', required: false },
      { name: 'strictPort', aliases: ['--strictPort'], type: 'boolean', defaultValue: false, required: false },
      {
        name: 'sassLogLevel',
        aliases: ['--sassLogLevel'],
        type: 'string',
        defaultValue: 'warn',
        required: false,
        choices: ['verbose', 'warn', 'error']
      }
    ]
  },
  {
    name: 'component:documentation',
    options: [
      { name: 'mdFile', aliases: ['--mdFile'], type: 'string', defaultValue: 'README.md', required: false },
      { name: 'noMd', aliases: ['--noMd'], type: 'boolean', defaultValue: false, required: false }
    ]
  },
  {
    name: 'component:install',
    options: [{ name: 'ci', aliases: ['--ci'], type: 'boolean', defaultValue: false, required: false }]
  },
  {
    name: 'component:lint',
    options: [
      { name: 'fix', aliases: ['--fix'], type: 'boolean', defaultValue: false, required: false },
      {
        name: 'abortOnFailure',
        aliases: ['--abortOnFailure'],
        type: 'boolean',
        defaultValue: false,
        required: false
      }
    ]
  },
  { name: 'component:locales', options: [] },
  {
    name: 'component:sass',
    options: [
      {
        name: 'sassLogLevel',
        aliases: ['--sassLogLevel'],
        type: 'string',
        defaultValue: 'warn',
        required: false,
        choices: ['verbose', 'warn', 'error']
      }
    ]
  },
  {
    name: 'component:test',
    options: [
      { name: 'wtr', aliases: ['--wtr'], type: 'boolean', defaultValue: false, required: false },
      { name: 'watch', aliases: ['-w', '--watch'], type: 'boolean', defaultValue: false, required: false },
      {
        name: 'updateSnapshots',
        aliases: ['--updateSnapshots'],
        type: 'boolean',
        defaultValue: false,
        required: false
      },
      {
        name: 'updateLocales',
        aliases: ['--updateLocales'],
        type: 'boolean',
        defaultValue: false,
        required: false
      },
      { name: 'coverage', aliases: ['--coverage'], type: 'boolean', defaultValue: false, required: false },
      {
        name: 'wtrTestsFinishTimeout',
        aliases: ['--wtrTestsFinishTimeout'],
        type: 'number',
        defaultValue: 120000,
        required: false
      }
    ]
  }
];

const SAMPLES = {
  string: 'custom-value',
  number: '9000',
  json: '{"profile":"academy-app"}',
  jsonOrPath: '{"profile":"academy-app"}',
  boolean: true
};

function optionSignature(option) {
  const signature = {
    name: option.name,
    aliases: [...option.aliases],
    type: option.type,
    required: option.required
  };

  if (Object.hasOwn(option, 'defaultValue')) {
    signature.defaultValue = option.defaultValue;
  }
  if (option.choices !== undefined) {
    signature.choices = [...option.choices];
  }
  return signature;
}

function requiredArguments(contract, exceptOptionName) {
  const args = [];
  for (const option of contract.options) {
    if (option.required && option.name !== exceptOptionName) {
      args.push(option.aliases[0], SAMPLES[option.type]);
    }
  }
  return args;
}

function expectedValue(option) {
  if (option.type === 'boolean') {
    return true;
  }
  if (option.type === 'number') {
    return 9000;
  }
  if (option.type === 'json' || option.type === 'jsonOrPath') {
    return { profile: 'academy-app' };
  }
  return option.choices?.[0] ?? 'custom-value';
}

test('break: removing any canonical command or changing its declared public grammar', () => {
  const registry = createCommandRegistry();

  assert.equal(registry.size, 19);
  assert.deepEqual([...registry.keys()], COMMAND_CONTRACTS.map(contract => contract.name));

  for (const contract of COMMAND_CONTRACTS) {
    const definition = registry.get(contract.name);
    assert.ok(definition, `missing ${contract.name}`);
    assert.deepEqual(definition.options.map(optionSignature), contract.options);
  }
});

test('break: exposing a mutable registry or mutable command grammar allows a later task to alter parsing', () => {
  const registry = createCommandRegistry();
  const command = registry.get('app:build');

  assert.ok(Object.isFrozen(registry));
  assert.ok(Object.isFrozen(command));
  assert.ok(Object.isFrozen(command.options));
  assert.ok(Object.isFrozen(command.options[0]));
  assert.ok(Object.isFrozen(command.options[0].aliases));
  assert.throws(() => registry.set('unexpected', command), TypeError);
  assert.throws(() => {
    command.options[0].aliases.push('--mutated');
  }, TypeError);
});

test('break: command definitions stop recognizing json-or-path while accepting unknown option types', () => {
  const definition = defineCommand({
    name: 'scaffold:input',
    summaryKey: 'command_app_create',
    options: [{ name: 'scaffold', aliases: ['-s'], type: 'jsonOrPath', required: false }],
    requiresWorkspace: false
  });

  assert.equal(definition.options[0].type, 'jsonOrPath');
  assert.throws(
    () => defineCommand({
      name: 'invalid:input',
      summaryKey: 'command_app_create',
      options: [{ name: 'invalid', aliases: ['--invalid'], type: 'unknown', required: false }],
      requiresWorkspace: false
    }),
    TypeError
  );
});

for (const contract of COMMAND_CONTRACTS) {
  test(`break: ${contract.name} stops applying its literal defaults`, () => {
    const parsed = parseArgv([contract.name, ...requiredArguments(contract)], createCommandRegistry(), {
      env: {},
      locale: 'en_US.UTF-8'
    });

    assert.equal(parsed.ok, true, JSON.stringify(parsed));
    assert.equal(parsed.action, 'command');
    assert.equal(parsed.command.name, contract.name);
    assert.equal(parsed.language, 'en');
    assert.ok(Object.isFrozen(parsed.options));

    for (const option of contract.options) {
      if (Object.hasOwn(option, 'defaultValue')) {
        assert.deepEqual(parsed.options[option.name], option.defaultValue);
      }
    }
  });

  for (const option of contract.options) {
    for (const alias of option.aliases) {
      test(`break: ${contract.name} no longer accepts ${alias} as ${option.name}`, () => {
        const args = [contract.name, ...requiredArguments(contract, option.name), alias];
        if (option.type !== 'boolean') {
          args.push(option.choices?.[0] ?? SAMPLES[option.type]);
        }

        const parsed = parseArgv(args, createCommandRegistry(), { env: {}, locale: 'en_US.UTF-8' });
        assert.equal(parsed.ok, true, JSON.stringify(parsed));
        assert.deepEqual(parsed.options[option.name], expectedValue(option));
      });
    }
  }
}

test('break: command-level -v is accidentally treated as a root version request', () => {
  const registry = createCommandRegistry();
  const rootVersion = parseArgv(['-v'], registry, { env: {}, locale: 'en_US.UTF-8' });
  const buildVerbose = parseArgv(['component:build:demo', '-v'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const unsupportedCommandVersion = parseArgv(['app:install', '-v'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });

  assert.deepEqual(rootVersion, { ok: true, action: 'version', language: 'en' });
  assert.equal(buildVerbose.ok, true);
  assert.equal(buildVerbose.action, 'command');
  assert.equal(buildVerbose.command.name, 'component:build:demo');
  assert.equal(buildVerbose.options.verbose, true);
  assert.equal(unsupportedCommandVersion.ok, false);
  assert.equal(unsupportedCommandVersion.code, 'UNKNOWN_OPTION');
});

test('break: root -v after a command without verbose is accepted as a root version request', () => {
  const parsed = parseArgv(['app:install', '-v'], createCommandRegistry(), {
    env: {},
    locale: 'en_US.UTF-8'
  });

  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, 'UNKNOWN_OPTION');
  assert.equal(parsed.messageKey, 'unknown_option');
});

test('break: app dev and preview can run without their required config option', () => {
  const registry = createCommandRegistry();
  const appDev = parseArgv(['app:dev'], registry, { env: {}, locale: 'en_US.UTF-8' });
  const appPreview = parseArgv(['app:preview'], registry, { env: {}, locale: 'en_US.UTF-8' });

  for (const result of [appDev, appPreview]) {
    assert.equal(result.ok, false);
    assert.equal(result.code, 'INVALID_INPUT');
    assert.equal(result.messageKey, 'missing_required_option');
    assert.equal(result.params.option, '-c');
  }
});

test('break: declared long boolean options no longer accept their standard --no- negation', () => {
  const registry = createCommandRegistry();
  const appDev = parseArgv(['app:dev', '--config', 'dev.js', '--no-open'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const componentDev = parseArgv(['component:dev', '--no-open'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const genericBoolean = parseArgv(['component:build:demo', '--no-verbose'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const nonBoolean = parseArgv(['app:dev', '--config', 'dev.js', '--no-host'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const unknown = parseArgv(['component:dev', '--no-missing'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const help = renderHelp(registry, 'en', 'component:dev');

  assert.equal(appDev.ok, true, JSON.stringify(appDev));
  assert.equal(appDev.options.open, false);
  assert.equal(componentDev.ok, true, JSON.stringify(componentDev));
  assert.equal(componentDev.options.open, false);
  assert.equal(genericBoolean.ok, true, JSON.stringify(genericBoolean));
  assert.equal(genericBoolean.options.verbose, false);
  for (const result of [nonBoolean, unknown]) {
    assert.equal(result.ok, false);
    assert.equal(result.code, 'UNKNOWN_OPTION');
  }
  assert.match(help, /--no-open/);
});

test('contract: legacy lit-component commands parse to their canonical component commands', () => {
  const registry = createCommandRegistry();
  const serve = parseArgv(['lit-component:serve', '--host', '127.0.0.1', '--port', '41099', '--no-open'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const testCommand = parseArgv(['lit-component:test', '--wtr', '--watch'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const docs = parseArgv(['help', 'lit-component:documentation'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });

  assert.equal(serve.ok, true, JSON.stringify(serve));
  assert.equal(serve.command.name, 'component:dev');
  assert.equal(serve.options.host, '127.0.0.1');
  assert.equal(serve.options.port, 41099);
  assert.equal(serve.options.open, false);
  assert.equal(testCommand.ok, true, JSON.stringify(testCommand));
  assert.equal(testCommand.command.name, 'component:test');
  assert.equal(testCommand.options.wtr, true);
  assert.equal(testCommand.options.watch, true);
  assert.equal(docs.ok, true, JSON.stringify(docs));
  assert.equal(docs.command.name, 'component:documentation');
});

test('contract: legacy app:serve parses to canonical app:dev with a nested market config', () => {
  const parsed = parseArgv(
    ['app:serve', '-c', 'co/web-dev.js', '--host', '127.0.0.1', '--port', '41211', '--no-open'],
    createCommandRegistry(),
    { env: {}, locale: 'en_US.UTF-8' }
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.command.name, 'app:dev');
  assert.equal(parsed.options.config, 'co/web-dev.js');
  assert.equal(parsed.options.host, '127.0.0.1');
  assert.equal(parsed.options.port, 41211);
  assert.equal(parsed.options.open, false);
});

test('break: component create stops retaining explicitly supplied boolean flags separately from defaults', () => {
  const registry = createCommandRegistry();
  const omitted = parseArgv(['component:create', '--scaffold', '{"name":"academy-card","namespace":"@academy"}'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const supplied = parseArgv(['component:create', '--e2e', '--no-install-deps', '--scaffold', '{"name":"academy-card","namespace":"@academy"}'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });

  assert.equal(omitted.ok, true, JSON.stringify(omitted));
  assert.equal(supplied.ok, true, JSON.stringify(supplied));
  assert.ok(Object.isFrozen(omitted.providedOptions));
  assert.ok(Object.isFrozen(supplied.providedOptions));
  assert.equal(omitted.providedOptions.e2e, undefined);
  assert.equal(omitted.providedOptions.installDeps, undefined);
  assert.deepEqual(
    { e2e: supplied.providedOptions.e2e, installDeps: supplied.providedOptions.installDeps },
    { e2e: true, installDeps: false }
  );
  assert.equal(supplied.options.e2e, true);
  assert.equal(supplied.options.installDeps, false);
});

test('break: an explicit --language or -l does not override ambient language after the command token', () => {
  const registry = createCommandRegistry();
  const beforeCommand = parseArgv(['--language', 'es', 'app:install'], registry, {
    env: { CELLS_ACADEMY_LANGUAGE: 'en' },
    locale: 'en_US.UTF-8'
  });
  const afterCommand = parseArgv(['app:install', '-l', 'es'], registry, {
    env: { CELLS_ACADEMY_LANGUAGE: 'en' },
    locale: 'en_US.UTF-8'
  });

  assert.equal(beforeCommand.ok, true);
  assert.equal(beforeCommand.language, 'es');
  assert.equal(afterCommand.ok, true);
  assert.equal(afterCommand.language, 'es');
  assert.equal(Object.hasOwn(afterCommand.options, 'language'), false);
});

test('break: command-local language aliases lose precedence to global language parsing after the command token', () => {
  const registry = createReadonlyMap([
    [
      'local:language',
      defineCommand({
        name: 'local:language',
        summaryKey: 'command_app_install',
        options: [
          {
            name: 'localLanguage',
            aliases: ['-l', '--language'],
            type: 'string',
            required: true
          }
        ],
        requiresWorkspace: false
      })
    ]
  ]);

  for (const alias of ['-l', '--language']) {
    const parsed = parseArgv(['-l', 'es', 'local:language', alias, 'domain-value'], registry, {
      env: { CELLS_ACADEMY_LANGUAGE: 'en' },
      locale: 'en_US.UTF-8'
    });

    assert.equal(parsed.ok, true, JSON.stringify(parsed));
    assert.equal(parsed.language, 'es');
    assert.equal(parsed.options.localLanguage, 'domain-value');
  }
});

test('break: language resolution ignores CELLS_ACADEMY_LANGUAGE, locale, or the English fallback', () => {
  const registry = createCommandRegistry();
  const fromEnvironment = parseArgv(['app:install'], registry, {
    env: { CELLS_ACADEMY_LANGUAGE: 'es' },
    locale: 'en_US.UTF-8'
  });
  const fromLocale = parseArgv(['app:install'], registry, { env: {}, locale: 'es_CO.UTF-8' });
  const fallback = parseArgv(['app:install'], registry, { env: {}, locale: 'pt_BR.UTF-8' });
  const invalidExplicit = parseArgv(['-l', 'pt', 'app:install'], registry, {
    env: {},
    locale: 'es_CO.UTF-8'
  });
  const missingExplicit = parseArgv(['--language='], registry, { env: {}, locale: 'en_US.UTF-8' });

  assert.equal(fromEnvironment.language, 'es');
  assert.equal(fromLocale.language, 'es');
  assert.equal(fallback.language, 'en');
  assert.equal(invalidExplicit.ok, false);
  assert.equal(invalidExplicit.code, 'INVALID_INPUT');
  assert.equal(invalidExplicit.messageKey, 'invalid_choice');
  assert.equal(missingExplicit.ok, false);
  assert.equal(missingExplicit.messageKey, 'missing_option_value');
});

test('break: unknown commands, unknown options, and missing values stop returning actionable failures', () => {
  const registry = createCommandRegistry();
  const unknownCommand = parseArgv(['unknown:command'], registry, { env: {}, locale: 'en_US.UTF-8' });
  const unknownRootOption = parseArgv(['--unknown'], registry, { env: {}, locale: 'en_US.UTF-8' });
  const unknownOption = parseArgv(['app:install', '--unknown'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const missingValue = parseArgv(['app:build', '--config'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const emptyInlineValue = parseArgv(['app:build', '--config='], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const missingRequired = parseArgv(['app:locales'], registry, { env: {}, locale: 'en_US.UTF-8' });

  assert.deepEqual(
    { code: unknownCommand.code, messageKey: unknownCommand.messageKey },
    { code: 'UNKNOWN_COMMAND', messageKey: 'unknown_command' }
  );
  assert.deepEqual(
    { code: unknownRootOption.code, messageKey: unknownRootOption.messageKey },
    { code: 'UNKNOWN_OPTION', messageKey: 'unknown_root_option' }
  );
  const rootError = renderOutcome(unknownRootOption, 'en');
  assert.match(rootError.stderr, /Run "cells --help"/);
  assert.doesNotMatch(rootError.stderr, /cells cells --help/);
  assert.deepEqual(
    { code: unknownOption.code, messageKey: unknownOption.messageKey },
    { code: 'UNKNOWN_OPTION', messageKey: 'unknown_option' }
  );
  assert.deepEqual(
    { code: missingValue.code, messageKey: missingValue.messageKey },
    { code: 'INVALID_INPUT', messageKey: 'missing_option_value' }
  );
  assert.deepEqual(
    { code: emptyInlineValue.code, messageKey: emptyInlineValue.messageKey },
    { code: 'INVALID_INPUT', messageKey: 'missing_option_value' }
  );
  assert.deepEqual(
    { code: missingRequired.code, messageKey: missingRequired.messageKey },
    { code: 'INVALID_INPUT', messageKey: 'missing_required_option' }
  );
});

test('break: help and version actions hide invalid trailing input instead of validating it', () => {
  const registry = createCommandRegistry();
  const invalidVersionTail = parseArgv(['--version', '--unknown'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const invalidCommandHelpTail = parseArgv(['app:install', '--help', '--unknown'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const rootHelpInSpanish = parseArgv(['--help', '--language', 'es'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const commandHelpInSpanish = parseArgv(['app:install', '--help', '--language', 'es'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });

  for (const result of [invalidVersionTail, invalidCommandHelpTail]) {
    assert.equal(result.ok, false);
    assert.equal(result.code, 'UNKNOWN_OPTION');
  }
  assert.deepEqual(rootHelpInSpanish, { ok: true, action: 'help', command: undefined, language: 'es' });
  assert.equal(commandHelpInSpanish.ok, true);
  assert.equal(commandHelpInSpanish.action, 'help');
  assert.equal(commandHelpInSpanish.command.name, 'app:install');
  assert.equal(commandHelpInSpanish.language, 'es');
});

test('break: scaffold transport stops preserving file paths while freezing inline JSON input', () => {
  const registry = createCommandRegistry();
  const appPath = parseArgv(['app:create', '-s', 'inputs/app.json'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const componentPath = parseArgv(['component:create', '-s', 'inputs/component.json'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const parsed = parseArgv(['app:create', '--scaffold', '  {"profile":"academy-app"}'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });

  assert.equal(appPath.ok, true, JSON.stringify(appPath));
  assert.equal(appPath.options.scaffold, 'inputs/app.json');
  assert.equal(componentPath.ok, true, JSON.stringify(componentPath));
  assert.equal(componentPath.options.scaffold, 'inputs/component.json');
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.ok(Object.isFrozen(parsed.options));
  assert.ok(Object.isFrozen(parsed.options.scaffold));
  assert.throws(() => {
    parsed.options.scaffold.profile = 'blank';
  }, TypeError);
  assert.equal(parsed.options.scaffold.profile, 'academy-app');
});

test('break: invalid ports, types, choices, and JSON reach a command instead of failing in the grammar', () => {
  const registry = createCommandRegistry();
  const portZero = parseArgv(['app:dev', '-p', '0'], registry, { env: {}, locale: 'en_US.UTF-8' });
  const portTooHigh = parseArgv(['component:dev', '-p=65536'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const portText = parseArgv(['app:preview', '-p', 'eight'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const level = parseArgv(['component:sass', '--sassLogLevel', 'loud'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const malformedJson = parseArgv(['app:create', '-s', '{bad'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });
  const malformedArray = parseArgv(['component:create', '-s', '[bad'], registry, {
    env: {},
    locale: 'en_US.UTF-8'
  });

  for (const result of [portZero, portTooHigh]) {
    assert.deepEqual(
      { code: result.code, messageKey: result.messageKey },
      { code: 'INVALID_INPUT', messageKey: 'invalid_port' }
    );
  }
  assert.deepEqual(
    { code: portText.code, messageKey: portText.messageKey },
    { code: 'INVALID_INPUT', messageKey: 'invalid_option_type' }
  );
  assert.deepEqual(
    { code: level.code, messageKey: level.messageKey },
    { code: 'INVALID_INPUT', messageKey: 'invalid_choice' }
  );
  for (const result of [malformedJson, malformedArray]) {
    assert.deepEqual(
      { code: result.code, messageKey: result.messageKey },
      { code: 'INVALID_INPUT', messageKey: 'invalid_option_type' }
    );
  }
});

test('break: errors stop being localized and outcomes become mutable', () => {
  const english = renderOutcome(fail('UNKNOWN_COMMAND', 'unknown_command', { command: 'unknown:command' }), 'en');
  const spanish = renderOutcome(fail('UNKNOWN_COMMAND', 'unknown_command', { command: 'unknown:command' }), 'es');
  const outcome = ok({ nested: { value: 1 } }, [{ key: 'not_implemented', params: { command: 'app:build' } }]);

  assert.equal(english.exitCode, 1);
  assert.match(english.stderr, /Unknown command "unknown:command"/);
  assert.match(english.stderr, /cells --help/);
  assert.equal(spanish.exitCode, 1);
  assert.match(spanish.stderr, /Comando desconocido "unknown:command"/);
  assert.match(spanish.stderr, /cells --help/);
  assert.equal(translate('es', 'version'), 'Versión');
  assert.ok(Object.isFrozen(outcome));
  assert.ok(Object.isFrozen(outcome.data));
  assert.ok(Object.isFrozen(outcome.data.nested));
  assert.ok(Object.isFrozen(outcome.messages));
  assert.throws(() => {
    outcome.data.nested.value = 2;
  }, TypeError);
});

test('break: generated help stops deriving its command list and option defaults from the immutable registry', () => {
  const registry = createCommandRegistry();
  const rootHelp = renderHelp(registry, 'en');
  const commandHelp = renderHelp(registry, 'es', 'app:build');
  const noOptionsHelp = renderHelp(registry, 'es', 'component:locales');
  const scaffoldHelp = renderHelp(registry, 'en', 'app:create');

  assert.match(rootHelp, /Usage: cells <command> \[options\]/);
  for (const { name } of COMMAND_CONTRACTS) {
    assert.match(rootHelp, new RegExp(name.replace(/:/g, '\\:')));
  }
  assert.match(commandHelp, /Uso: cells app:build/);
  assert.match(commandHelp, /--config/);
  assert.match(commandHelp, /obligatoria/);
  assert.match(commandHelp, /--sourceMap/);
  assert.match(commandHelp, /false/);
  assert.match(noOptionsHelp, /ninguna/);
  assert.doesNotMatch(noOptionsHelp, /\(none\)/);
  assert.match(scaffoldHelp, /--scaffold <json>/);
  assert.doesNotMatch(scaffoldHelp, /type_jsonOrPath/);
});

test('break: test coverage remains parseable and visible in app and component help', () => {
  const registry = createCommandRegistry();

  for (const name of ['app:test', 'component:test']) {
    const parsed = parseArgv([name, '--coverage'], registry, { env: {}, locale: 'en_US.UTF-8' });
    const help = renderHelp(registry, 'en', name);

    assert.equal(parsed.ok, true, JSON.stringify(parsed));
    assert.equal(parsed.options.coverage, true);
    assert.match(help, /--coverage/);
  }
});
