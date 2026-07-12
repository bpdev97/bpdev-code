export const PERSONAL_DISTRIBUTION = {
  repository: {
    owner: "bpdev97",
    name: "bpdev-code",
  },
  mobile: {
    appName: "bpdev code",
    developmentAppName: "bpdev code Dev",
    previewAppName: "bpdev code Preview",
    scheme: "bpdev-code",
    developmentScheme: "bpdev-code-dev",
    previewScheme: "bpdev-code-preview",
    expoOwner: "bpdev97",
    expoSlug: "t3-code-personal",
    expoProjectId: "8c5853ac-04f2-4d67-9f59-a699cb3c9776",
    iosBundleIdentifier: "com.bpdev97.t3code.ios",
    appleTeamId: "BL9B7SKPHX",
  },
  macos: {
    appId: "com.bpdev97.t3code.macos",
    productName: "bpdev code",
    developmentProductName: "bpdev code Dev",
    nightlyProductName: "bpdev code Nightly",
    artifactName: "bpdev-code-${version}-${arch}.${ext}",
    stateHomeDirectoryName: ".bpdev-code",
    userDataDirectoryName: "bpdev-code",
  },
} as const;
