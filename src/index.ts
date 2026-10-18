import { Ajv } from 'ajv';
import { satisfies, valid, validRange } from 'semver';
import schema from './component-manifest.schema.json' with { type: 'json' };

export const componentManifestSchema: object = schema;

export interface EngineRequirement {
  name: string;
  range: string;
}

interface ManifestBase {
  schemaVersion: 1;
  package: string;
  version: string;
}

interface CoreCompatibility {
  hyperion: string;
  sdk: string;
}

export type ComponentManifest = ManifestBase & (
  | { kind: 'plugin' | 'protocol'; compatibility: CoreCompatibility }
  | { kind: 'backend-adapter'; compatibility: CoreCompatibility & { engines: EngineRequirement[] } }
);

export interface Diagnostic {
  code: string;
  /** JSON Pointer into the manifest or environment supplied to the public function. */
  path: string;
  message: string;
}

export type ManifestValidationResult =
  | { valid: true; manifest: ComponentManifest }
  | { valid: false; errors: Diagnostic[] };

/** Exact SemVer, including prerelease/build metadata, without v/= prefixes or whitespace. */
function isExactVersion(value: string): boolean {
  return value.trim() === value && /^[0-9]/.test(value) && valid(value) !== null;
}

const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addFormat('semver-version', { type: 'string', validate: isExactVersion });
ajv.addFormat('semver-range', {
  type: 'string',
  validate: (value: string) => value.trim().length > 0 && validRange(value) !== null,
});
const validate = ajv.compile<ComponentManifest>(componentManifestSchema);
const engineNamePattern = new RegExp(schema.definitions.engines.items.properties.name.pattern);

/** Validate inert metadata; this function never loads or executes a component. */
export function validateComponentManifest(input: unknown): ManifestValidationResult {
  if (!validate(input)) {
    return {
      valid: false,
      errors: (validate.errors ?? []).map(error => ({
        code: `manifest.${error.keyword}`,
        path: error.instancePath,
        message: error.message ?? 'Invalid component manifest',
      })),
    };
  }
  if (input.kind === 'backend-adapter') {
    const names = new Set<string>();
    for (const [index, engine] of input.compatibility.engines.entries()) {
      if (names.has(engine.name)) {
        return {
          valid: false,
          errors: [{ code: 'manifest.duplicate-engine', path: `/compatibility/engines/${index}/name`,
            message: `Engine ${engine.name} is declared more than once` }],
        };
      }
      names.add(engine.name);
    }
  }
  return { valid: true, manifest: input };
}

export interface CompatibilityEnvironment {
  hyperion: string;
  sdk: string;
  engines?: Record<string, string>;
}

export interface CompatibilityResult {
  /** Range eligibility only; true is not evidence of tested compatibility. */
  compatible: boolean;
  errors: Diagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Check declared ranges against exact installed versions, using standard node-semver rules. */
export function checkCompatibility(manifest: unknown, environment: unknown): CompatibilityResult {
  const result = validateComponentManifest(manifest);
  if (!result.valid) {
    return { compatible: false, errors: result.errors.map(error => ({
      ...error, path: `/manifest${error.path}`,
    })) };
  }
  if (!isRecord(environment)) {
    return { compatible: false, errors: [{ code: 'compatibility.invalid-environment',
      path: '/environment', message: 'Expected an object with exact installed versions' }] };
  }
  const errors: Diagnostic[] = [];
  const check = (actual: unknown, range: string, path: string): void => {
    if (actual === undefined) {
      errors.push({ code: 'compatibility.missing-version', path,
        message: `Required version is missing (requires ${range})` });
    } else if (typeof actual !== 'string' || !isExactVersion(actual)) {
      errors.push({ code: 'compatibility.invalid-version', path,
        message: 'Expected an exact semantic version' });
    } else if (!satisfies(actual, range)) {
      errors.push({ code: 'compatibility.out-of-range', path,
        message: `${actual} does not satisfy ${range}` });
    }
  };
  const requirements = result.manifest.compatibility;
  check(environment.hyperion, requirements.hyperion, '/environment/hyperion');
  check(environment.sdk, requirements.sdk, '/environment/sdk');
  if (environment.engines !== undefined && !isRecord(environment.engines)) {
    errors.push({ code: 'compatibility.invalid-engines', path: '/environment/engines',
      message: 'Expected an object mapping engine identifiers to exact installed versions' });
  } else {
    const engines = environment.engines;
    if (isRecord(engines)) {
      for (const [name, version] of Object.entries(engines)) {
        const path = `/environment/engines/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`;
        if (!engineNamePattern.test(name)) {
          errors.push({ code: 'compatibility.invalid-engine-name', path,
            message: 'Expected a lowercase engine identifier' });
        }
        if (typeof version !== 'string' || !isExactVersion(version)) {
          errors.push({ code: 'compatibility.invalid-version', path,
            message: 'Expected an exact semantic version' });
        }
      }
    }
    if (result.manifest.kind === 'backend-adapter') {
      for (const requirement of result.manifest.compatibility.engines) {
        const actual = isRecord(engines) && Object.hasOwn(engines, requirement.name)
          ? engines[requirement.name] : undefined;
        // Supplied malformed values were reported above; missing requirements still fail here.
        if (actual === undefined || (typeof actual === 'string' && isExactVersion(actual))) {
          check(actual, requirement.range, `/environment/engines/${requirement.name}`);
        }
      }
    }
  }
  return { compatible: errors.length === 0, errors };
}
