/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COORD_URL: string;
  readonly VITE_REGISTRY_URL: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID: string;
  readonly VITE_TREASURY_ADDRESS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

