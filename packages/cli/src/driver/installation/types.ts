export const driverSdkPackageName = '@suites/blackbox-driver';
export const defaultDriverSdkSpec = '0.0.0';

export interface PackageManagerInstallInput {
  readonly directory: string;
}

export type PackageManagerInstallResult =
  | {
      readonly kind: 'package-manager-install-succeeded';
      readonly packageManager: 'npm';
      readonly exitCode: 0;
      readonly stderr: string;
    }
  | {
      readonly kind: 'package-manager-install-failed';
      readonly packageManager: 'npm';
      readonly exitCode: number;
      readonly stderr: string;
    };

export type PackageManagerInstaller = (
  input: PackageManagerInstallInput,
) => Promise<PackageManagerInstallResult>;

export type DriverRuntimeFileAction = 'created' | 'updated' | 'retained';

export type DriverRuntimeInstallationFailure =
  | {
      readonly kind: 'driver-installation-in-progress';
      readonly lockDirectory: string;
    }
  | {
      readonly kind: 'driver-package-invalid';
      readonly path: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'driver-runtime-artifact-invalid';
      readonly path: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'driver-package-manager-failed';
      readonly packageManager: 'npm';
      readonly exitCode: number;
      readonly stderr: string;
    }
  | {
      readonly kind: 'driver-sdk-unresolved';
      readonly packageName: typeof driverSdkPackageName;
      readonly reason: string;
    }
  | {
      readonly kind: 'driver-installation-operational-failure';
      readonly reason: string;
    };

export type DriverRuntimeInstallationResult =
  | {
      readonly kind: 'driver-runtime-installation-succeeded';
      readonly ok: true;
      readonly runtime: 'node';
      readonly directory: string;
      readonly files: {
        readonly kind: 'driver-runtime-files';
        readonly package: DriverRuntimeFileAction;
        readonly runtime: DriverRuntimeFileAction;
      };
      readonly dependency: {
        readonly kind: 'driver-sdk-installed';
        readonly packageName: typeof driverSdkPackageName;
        readonly spec: string;
        readonly installationPath: string;
        readonly entrypoint: string;
      };
    }
  | {
      readonly kind: 'driver-runtime-installation-failed';
      readonly ok: false;
      readonly runtime: 'node';
      readonly directory: string;
      readonly failure: DriverRuntimeInstallationFailure;
      readonly message: string;
    };

export interface InstallDriverRuntimeInput {
  readonly projectDirectory: string;
  readonly packageManager: PackageManagerInstaller;
}
