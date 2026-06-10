import { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "cam.terminalvelocity.mobile",
  appName: "TERMINAL VELOCITY",
  // The "www/" directory is what's copied into the native projects.
  // scripts/build-web.mjs assembles it from web/.
  webDir: "www",
  android: {
    allowMixedContent: false,
    backgroundColor: "#000000"
  },
  ios: {
    backgroundColor: "#000000",
    contentInset: "always"
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: "#000000",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true
    }
  },
  server: {
    androidScheme: "https"
  }
};

export default config;
