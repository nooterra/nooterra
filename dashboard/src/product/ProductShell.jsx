import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  fetchApprovalInbox,
  fetchTenantSettings,
  fetchWorkOrderReceipts,
  fetchWorkOrderReceiptDetail,
  formatDateTime,
  formatCurrency,
  loadRuntimeConfig,
  PRODUCT_RUNTIME_STORAGE_KEY,
} from "./api.js";
import {
  S, STATUS_COLORS, ONBOARDING_STORAGE_KEY,
  navigate, getGreeting, getInitials, tierLabel, tierColor,
  workerApiRequest, saveRuntime, saveOnboardingState, loadOnboardingState,
  loadTheme, saveTheme, applyTheme, fetchSessionPrincipal,
  humanizeSchedule, ALL_MODELS,
} from "./shared.js";
import "./product.css";

/* -- Lazy-loaded views -------------------------------------------- */
const AuthView = React.lazy(() => import("./views/AuthView.jsx"));
const BuilderView = React.lazy(() => import("./views/BuilderView.jsx"));
const WorkerDetailView = React.lazy(() => import("./views/WorkerDetailView.jsx"));
const WorkersListView = React.lazy(() => import("./views/WorkersListView.jsx"));
const InboxView = React.lazy(() => import("./views/InboxView.jsx"));
const PerformanceView = React.lazy(() => import("./views/PerformanceView.jsx"));
const IntegrationsView = React.lazy(() => import("./views/IntegrationsView.jsx"));

/* -- Eagerly-loaded components (small) ----------------------------- */
import SettingsModal from "./components/SettingsModal.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import ToastNotification from "./components/ToastNotification.jsx";

/* ===================================================================
   FocusInput
   =================================================================== */

function FocusInput({ style, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      style={{ ...S.input, ...style, ...(focused ? S.inputFocus : {}) }}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}


/* ===================================================================
   Inline SVG icons
   =================================================================== */

function SidebarToggleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" style={{ display: "block" }}>
      <path d="M3 4h12M3 9h12M3 14h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" style={{ display: "block" }}>
      <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ display: "block" }}>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SendArrow({ disabled, onClick }) {
  return (
    <button
      onClick={onClick} disabled={disabled} aria-label="Send"
      style={{
        width: 32, height: 32, borderRadius: "50%",
        background: disabled ? "var(--bg-hover)" : "var(--text-primary)",
        border: "none", cursor: disabled ? "default" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, transition: "opacity 150ms",
        opacity: disabled ? 0.3 : 1,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ display: "block" }}>
        <path d="M8 12V4M4 8l4-4 4 4" stroke={disabled ? "var(--text-tertiary)" : "var(--bg-primary)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function CloseIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" style={{ display: "block" }}>
      <path d="M5 5l8 8M13 5l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}


function NooterraLogo({ height = 24, style: extraStyle }) {
  return (
    <svg viewBox="0 0 2172 724" fill="currentColor" style={{ height, width: "auto", display: "block", ...extraStyle }}>
      <path d="M0 0 C26.82470779 -0.51238206 48.35993864 8.34450534 67.94287109 26.45019531 C75.77680499 34.05522277 82.40238135 42.89909015 88.9765625 51.5859375 C92.11919943 55.73683711 95.33317141 59.83149753 98.5390625 63.93359375 C103.08579633 69.75984763 107.56435892 75.62989524 111.9765625 81.55859375 C116.70169946 87.89406357 121.55140725 94.09078243 126.6640625 100.12109375 C127.36789062 100.971875 128.07171875 101.82265625 128.796875 102.69921875 C136.21349966 111.36523896 145.07632687 118.70097111 155.6640625 123.12109375 C156.40011719 123.49105469 157.13617187 123.86101562 157.89453125 124.2421875 C169.05673162 129.24354549 183.27353069 128.85830137 194.7890625 125.05859375 C207.67429698 120.08338391 216.587739 112.08652183 222.62109375 99.7109375 C227.48411387 87.63534821 227.52914293 72.25782465 222.6640625 60.12109375 C216.01039096 46.75965577 206.30399199 39.85163693 192.5 35.01171875 C180.88091103 32.31400767 166.27017229 32.35729644 155.6640625 38.12109375 C154.85582031 38.52199219 154.04757812 38.92289062 153.21484375 39.3359375 C142.3473334 45.22179476 133.8643998 54.26647032 126.6015625 64.1015625 C125.9621875 64.76800781 125.3228125 65.43445313 124.6640625 66.12109375 C120.6640625 66.12109375 120.6640625 66.12109375 119.12890625 64.79296875 C118.62488281 64.15875 118.12085938 63.52453125 117.6015625 62.87109375 C114.01447146 58.51199834 110.24350306 54.37508458 106.39624023 50.24707031 C104.26982944 47.94682101 102.40688231 45.73532347 100.6640625 43.12109375 C101.10833159 37.66145927 106.0683126 34.18839809 109.7265625 30.55859375 C110.53206543 29.75663574 111.33756836 28.95467773 112.16748047 28.12841797 C132.03498754 8.79797573 154.2292148 -0.27547494 182.04858398 -0.25170898 C194.651332 0.02499806 206.53515251 3.15559695 217.6640625 9.12109375 C218.62570312 9.61222656 219.58734375 10.10335938 220.578125 10.609375 C239.87753877 21.05699046 253.35834006 38.64037229 259.9375 59.46484375 C265.26463291 78.94038344 262.43145853 100.38883528 252.80322266 117.90307617 C249.84715865 123.0348852 246.49675819 127.62344845 242.6640625 132.12109375 C242.03177734 132.98541016 242.03177734 132.98541016 241.38671875 133.8671875 C230.3163981 148.43694082 210.33522217 156.9562848 192.8125 159.58203125 C186.48774773 160.35321835 180.15449687 160.44926358 173.7890625 160.49609375 C172.09620117 160.51687988 172.09620117 160.51687988 170.36914062 160.53808594 C160.69818308 160.48407412 152.19090575 158.76446917 143.66796875 154.1328125 C141.50385858 153.04021107 139.32893435 152.28917132 137.0390625 151.49609375 C120.89870879 145.11904742 106.88667542 130.73143304 96.6640625 117.12109375 C95.35018909 115.44150833 94.02710563 113.76942567 92.70361328 112.09741211 C85.09379595 102.47415847 77.57950415 92.78499827 70.3515625 82.87109375 C48.71788768 51.05893033 48.71788768 51.05893033 15.6640625 34.12109375 C3.45829074 33.00036536 -8.58588928 32.63334535 -19.3359375 39.12109375 C-20.3878125 39.69859375 -21.4396875 40.27609375 -22.5234375 40.87109375 C-32.13524281 48.560538 -37.42648281 56.39272968 -41.3359375 68.12109375 C-42.66989133 83.78079178 -41.34219937 97.46919719 -31.3359375 110.12109375 C-29.06520141 112.80852881 -29.06520141 112.80852881 -26.3359375 115.12109375 C-25.70042969 115.68699219 -25.06492187 116.25289063 -24.41015625 116.8359375 C-18.8143425 121.53721619 -13.29111459 124.00033484 -6.3359375 126.12109375 C-4.8509375 126.61609375 -4.8509375 126.61609375 -3.3359375 127.12109375 C13.19549418 128.35346885 28.4168698 125.84685885 41.6640625 115.12109375 C47.47572052 109.89368608 52.87324757 104.30498252 57.6640625 98.12109375 C61.06159401 99.54495358 62.79231258 101.19660918 65.01171875 104.11328125 C65.61693359 104.90089844 66.22214844 105.68851562 66.84570312 106.5 C67.46638672 107.32371094 68.08707031 108.14742188 68.7265625 108.99609375 C69.35111328 109.81207031 69.97566406 110.62804687 70.61914062 111.46875 C72.30916457 113.68003 73.98990856 115.89778383 75.6640625 118.12109375 C76.50831787 119.16692627 76.50831787 119.16692627 77.36962891 120.23388672 C78.6640625 122.12109375 78.6640625 122.12109375 78.58984375 124.57421875 C75.16152126 134.00572197 64.61448399 140.72004696 56.6640625 146.12109375 C55.73980469 146.75015625 54.81554687 147.37921875 53.86328125 148.02734375 C34.26116223 160.39050595 8.22584593 164.02448785 -14.33984375 158.9921875 C-19.13787114 157.69476399 -23.75287145 156.03740499 -28.3359375 154.12109375 C-29.50125 153.6415625 -30.6665625 153.16203125 -31.8671875 152.66796875 C-38.83661404 149.46484847 -44.64702585 145.23312669 -50.3359375 140.12109375 C-51.25503906 139.29609375 -52.17414062 138.47109375 -53.12109375 137.62109375 C-59.94981991 131.1586954 -64.88310008 124.38227897 -69.3359375 116.12109375 C-70.18671875 114.57808594 -70.18671875 114.57808594 -71.0546875 113.00390625 C-80.58382107 94.27261918 -80.72072288 71.76113641 -74.33984375 52.04296875 C-71.25072044 43.87656663 -66.57940522 37.01758688 -61.3359375 30.12109375 C-60.71976563 29.30640625 -60.10359375 28.49171875 -59.46875 27.65234375 C-48.20182337 13.91926579 -29.77661541 3.35864671 -12.3359375 0.65625 C-8.2257669 0.25725737 -4.12512005 0.14974089 0 0 Z " transform="translate(749.3359375,289.87890625)"/>
      <path d="M0 0 C11.8480311 11.01441214 17.01089326 25.95698704 17.71753693 41.85995865 C17.8888242 48.83558456 17.83899388 55.8120426 17.8046875 62.7890625 C17.80095078 65.03492608 17.79810693 67.2807913 17.79611206 69.5266571 C17.7885275 75.39721286 17.76892422 81.26766743 17.7467041 87.13818359 C17.72613335 93.14484285 17.71708647 99.15151869 17.70703125 105.15820312 C17.68567282 116.91411379 17.65053364 128.66992322 17.609375 140.42578125 C5.729375 140.42578125 -6.150625 140.42578125 -18.390625 140.42578125 C-18.720625 134.81578125 -19.050625 129.20578125 -19.390625 123.42578125 C-21.040625 125.40578125 -22.690625 127.38578125 -24.390625 129.42578125 C-27.56358354 132.00699833 -30.96411354 134.19582935 -34.390625 136.42578125 C-35.999375 137.53953125 -35.999375 137.53953125 -37.640625 138.67578125 C-48.86139082 144.70174808 -66.13974397 145.71366235 -78.3984375 142.51171875 C-91.17274261 138.23522352 -102.69282893 130.38613138 -109.390625 118.42578125 C-114.91648242 106.12563195 -118.18726709 92.82640627 -113.890625 79.61328125 C-107.87944638 65.5378102 -97.37754853 56.09925785 -83.390625 50.42578125 C-67.67696368 45.09163027 -51.91021574 45.2762681 -35.515625 45.36328125 C-33.84505344 45.36831211 -32.1744804 45.37287218 -30.50390625 45.37695312 C-26.46610818 45.38781966 -22.42838368 45.40499444 -18.390625 45.42578125 C-18.69520945 43.33014253 -19.00475017 41.23522373 -19.31640625 39.140625 C-19.57417847 37.39060181 -19.57417847 37.39060181 -19.8371582 35.60522461 C-20.91325514 29.42348202 -23.42734048 25.64183763 -28.26953125 21.81640625 C-37.05343912 16.05752742 -47.16343531 15.02714805 -57.390625 16.42578125 C-65.52830792 18.3843716 -72.41069167 21.50745614 -77.390625 28.42578125 C-78.84132464 31.1574646 -78.84132464 31.1574646 -79.390625 33.42578125 C-86.83424586 32.80931327 -93.69969597 30.77972604 -100.828125 28.61328125 C-102.02373047 28.26974609 -103.21933594 27.92621094 -104.45117188 27.57226562 C-105.58490234 27.22873047 -106.71863281 26.88519531 -107.88671875 26.53125 C-108.91982178 26.22340576 -109.9529248 25.91556152 -111.01733398 25.59838867 C-113.390625 24.42578125 -113.390625 24.42578125 -114.30224609 22.44702148 C-114.55356466 16.69932429 -108.56381524 10.77234936 -105.01171875 6.6953125 C-79.06225591 -20.14755908 -29.66308359 -22.76170143 0 0 Z " transform="translate(1628.390625,303.57421875)"/>
      <path d="M0 0 C16.09066572 13.88878515 22.29079914 31.3441877 25.22265625 51.8671875 C25.22265625 59.1271875 25.22265625 66.3871875 25.22265625 73.8671875 C-10.08734375 73.8671875 -45.39734375 73.8671875 -81.77734375 73.8671875 C-78.30522473 92.75256143 -78.30522473 92.75256143 -66.34375 106.70703125 C-56.15101644 113.05227939 -45.54809203 114.34073506 -33.77734375 112.8671875 C-23.69678868 110.50243645 -15.18566121 104.84166114 -9.33984375 96.3671875 C-6.77734375 93.8671875 -6.77734375 93.8671875 -4.88574219 93.7890625 C-4.16418945 93.89734375 -3.44263672 94.005625 -2.69921875 94.1171875 C-1.89943604 94.23126953 -1.09965332 94.34535156 -0.27563477 94.46289062 C0.54880127 94.59630859 1.3732373 94.72972656 2.22265625 94.8671875 C3.38873413 95.04411133 3.38873413 95.04411133 4.57836914 95.22460938 C6.90089238 95.58631982 9.21796492 95.97285502 11.53515625 96.3671875 C12.31955078 96.49738281 13.10394531 96.62757813 13.91210938 96.76171875 C17.39117828 97.34698268 20.80629274 97.97840849 24.22265625 98.8671875 C23.23555756 109.90600952 15.38068569 120.5798837 7.22265625 127.8671875 C-1.16244985 134.16897305 -9.75376493 138.65207731 -19.77734375 141.8671875 C-20.64746094 142.18558594 -21.51757812 142.50398437 -22.4140625 142.83203125 C-41.34576483 148.82937345 -62.63542708 145.22638748 -80.27734375 137.0546875 C-99.05979538 126.87330338 -111.16558165 110.02951899 -117.24633789 89.88305664 C-119.25961252 82.2400182 -119.0279164 74.26511445 -119.07250977 66.41577148 C-119.0839637 65.02081099 -119.10431001 63.625892 -119.1340332 62.23120117 C-119.42292345 48.60494218 -117.34597743 36.14183292 -110.58984375 24.0546875 C-110.20183594 23.3438501 -109.81382813 22.6330127 -109.4140625 21.90063477 C-105.96001487 15.78850249 -101.85608892 10.72318069 -96.77734375 5.8671875 C-95.76800781 4.82884766 -95.76800781 4.82884766 -94.73828125 3.76953125 C-69.86910279 -20.40107478 -26.96235445 -20.70526797 0 0 Z " transform="translate(1253.77734375,303.1328125)"/>
      <path d="M0 0 C10.54959573 9.54973075 16.85456711 23.78759695 18.05391693 37.87115288 C18.3893869 45.07145299 18.29173783 52.27499339 18.22265625 59.48046875 C18.21518052 61.79073086 18.2094939 64.10099938 18.20550537 66.41127014 C18.19035391 72.44304423 18.15116407 78.47442286 18.10668945 84.50604248 C18.06550868 90.68040622 18.04744597 96.8548349 18.02734375 103.02929688 C17.98465829 115.10827315 17.91439587 127.18685406 17.83203125 139.265625 C5.95203125 139.265625 -5.92796875 139.265625 -18.16796875 139.265625 C-18.17731445 136.41510498 -18.18666016 133.56458496 -18.19628906 130.62768555 C-18.2301476 121.18000099 -18.28574587 111.73253281 -18.35187149 102.28502178 C-18.39127894 96.56036466 -18.4235005 90.83585982 -18.43896484 85.11108398 C-18.45417565 79.58010313 -18.48869993 74.04954111 -18.53627777 68.51874733 C-18.55104596 66.41502345 -18.55900713 64.31123976 -18.5598526 62.20746422 C-18.31629797 43.02452355 -18.31629797 43.02452355 -27.453125 26.69921875 C-35.94906294 19.59669205 -46.20815329 19.31081487 -56.77099609 19.95751953 C-65.78193036 21.11577977 -73.04576786 27.11858136 -78.5859375 34.01171875 C-84.65778133 42.66222219 -86.45721742 51.6428887 -86.48681641 62.09008789 C-86.50188484 63.3356395 -86.50188484 63.3356395 -86.51725769 64.60635376 C-86.54784109 67.31699 -86.5650549 70.02752866 -86.58203125 72.73828125 C-86.60076294 74.63114752 -86.62033782 76.52400561 -86.64071655 78.41685486 C-86.69183241 83.37331298 -86.73156755 88.32979812 -86.76885986 93.28637695 C-86.80902897 98.35439625 -86.86006216 103.42230518 -86.91015625 108.49023438 C-87.00667204 118.41529439 -87.09014867 128.34040077 -87.16796875 138.265625 C-98.71796875 138.265625 -110.26796875 138.265625 -122.16796875 138.265625 C-122.16796875 88.765625 -122.16796875 39.265625 -122.16796875 -11.734375 C-110.61796875 -11.734375 -99.06796875 -11.734375 -87.16796875 -11.734375 C-86.67296875 -3.319375 -86.67296875 -3.319375 -86.16796875 5.265625 C-85.11609375 4.110625 -84.06421875 2.955625 -82.98046875 1.765625 C-60.50249812 -20.51447617 -23.8872565 -19.1098052 0 0 Z " transform="translate(634.16796875,304.734375)"/>
      <path d="M0 0 C11.88 0 23.76 0 36 0 C36 14.19 36 28.38 36 43 C47.55 43 59.1 43 71 43 C71 53.23 71 63.46 71 74 C59.45 74 47.9 74 36 74 C36.03274174 87.08619255 36.03274174 87.08619255 36.11132812 100.171875 C36.15357243 105.51535221 36.19064463 110.85848947 36.19555664 116.20214844 C36.19986033 120.51429204 36.2284928 124.8256723 36.27343178 129.13757706 C36.28634105 130.77600774 36.29073794 132.41453009 36.28615379 134.05300522 C36.26665023 143.14735166 36.33094866 151.37084452 42 159 C47.1846131 163.53653646 51.7820912 163.39719636 58.5234375 163.23828125 C62.69294248 162.95250619 66.84627471 162.46152503 71 162 C71 172.56 71 183.12 71 194 C65.32778561 195.13444288 60.07422298 195.1839889 54.3125 195.1875 C53.27416016 195.19974609 52.23582031 195.21199219 51.16601562 195.22460938 C36.26253624 195.252641 25.20710147 191.76966519 14.2578125 181.38671875 C1.0539493 167.42900177 -0.31488961 150.68475242 -0.1953125 132.3984375 C-0.19157557 130.70879281 -0.18873181 129.01914593 -0.18673706 127.32949829 C-0.17915411 122.91381697 -0.1595524 118.49827027 -0.1373291 114.0826416 C-0.11675474 109.5642275 -0.10771072 105.04579134 -0.09765625 100.52734375 C-0.07630069 91.68482761 -0.041163 82.84244614 0 74 C-9.9 74 -19.8 74 -30 74 C-30 63.77 -30 53.54 -30 43 C-20.1 43 -10.2 43 0 43 C0 28.81 0 14.62 0 0 Z " transform="translate(1049,250)"/>
      <path d="M0 0 C0.90492187 0.00064453 1.80984375 0.00128906 2.7421875 0.00195312 C9.35916241 0.04666241 9.35916241 0.04666241 10.5 1.1875 C10.58855161 3.8537603 10.61524673 6.49397114 10.59765625 9.16015625 C10.5962413 9.95779892 10.59482635 10.75544159 10.59336853 11.57725525 C10.58775316 14.13487435 10.57519812 16.69240718 10.5625 19.25 C10.55748698 20.97981645 10.55292373 22.70963426 10.54882812 24.43945312 C10.53777875 28.68883553 10.52050386 32.93815312 10.5 37.1875 C2.83496094 36.25537109 2.83496094 36.25537109 -0.1796875 35.64453125 C-9.83060076 33.74359379 -18.66366318 35.55702276 -26.98046875 40.73046875 C-35.85693042 47.22797922 -41.50934269 55.58812356 -44.5 66.1875 C-45.41131387 72.87147495 -45.22328438 79.65961893 -45.20703125 86.390625 C-45.22016871 88.32405134 -45.23547916 90.25746402 -45.25285339 92.19085693 C-45.29247673 97.24110244 -45.30287915 102.29098706 -45.30688477 107.34136963 C-45.31625919 112.51024161 -45.35369943 117.6789053 -45.38867188 122.84765625 C-45.45301692 132.96097739 -45.48384726 143.07398697 -45.5 153.1875 C-57.38 153.1875 -69.26 153.1875 -81.5 153.1875 C-81.5 103.3575 -81.5 53.5275 -81.5 2.1875 C-69.62 2.1875 -57.74 2.1875 -45.5 2.1875 C-45.005 11.5925 -45.005 11.5925 -44.5 21.1875 C-42.97375 19.5375 -41.4475 17.8875 -39.875 16.1875 C-28.63610681 4.63393156 -15.99899264 -0.22417468 0 0 Z " transform="translate(1384.5,290.8125)"/>
      <path d="M0 0 C0 12.54 0 25.08 0 38 C-5 37 -5 37 -8 36 C-20.25561881 35.01632533 -30.37940325 36.85429127 -39.9296875 44.8984375 C-52.27289586 57.42795844 -52.4544444 72.83128671 -52.51171875 89.328125 C-52.52859583 91.17186657 -52.54675007 93.01559686 -52.56611633 94.85931396 C-52.61329385 99.67271392 -52.64331066 104.48606807 -52.66955566 109.29962158 C-52.69952532 114.22718345 -52.74599861 119.15458795 -52.79101562 124.08203125 C-52.87668124 133.72128921 -52.94265993 143.36053189 -53 153 C-64.55 153 -76.1 153 -88 153 C-88 103.5 -88 54 -88 3 C-76.45 3 -64.9 3 -53 3 C-52.505 12.405 -52.505 12.405 -52 22 C-50.6078125 20.2675 -50.6078125 20.2675 -49.1875 18.5 C-35.28119913 2.69102617 -20.62520751 0 0 0 Z " transform="translate(1503,290)"/>
    </svg>
  );
}


/* ===================================================================
   ReceiptsView
   =================================================================== */

function ReceiptsView() {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { try { const runtime = loadRuntimeConfig(); const result = await fetchWorkOrderReceipts(runtime, { limit: 50 }); setReceipts(result?.items || result || []); } catch { setReceipts([]); } setLoading(false); })(); }, []);
  return (
    <div>
      <h1 style={S.pageTitle}>History</h1>
      <p style={S.pageSub}>Execution log across all workers.</p>
      {loading ? <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div> : receipts.length === 0 ? <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>No executions yet.</div> : receipts.map(r => (
        <div key={r.id || r.receiptId} style={S.logEntry}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: "14px", color: "var(--text-primary)" }}>{r.workerName || r.agentName || r.summary || r.id || "Execution"}</div>
              <div style={S.logTime}>{r.completedAt ? formatDateTime(r.completedAt) : r.createdAt ? formatDateTime(r.createdAt) : ""}</div>
            </div>
            {r.cost != null && <div style={{ ...S.workerMeta, color: "var(--text-secondary)" }}>{typeof r.cost === "number" ? `$${r.cost.toFixed(2)}` : formatCurrency(r.cost)}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}


/* ===================================================================
   PricingView
   =================================================================== */

function PricingView() {
  const tiers = [
    { name: "Free", price: "Free forever", features: ["Local CLI workers", "Any AI provider (bring your own key)", "Unlimited workers and runs", "Charter-based governance", "Full activity logs"], cta: "Install CLI", ctaHref: "https://docs.nooterra.ai", primary: false },
    { name: "Pro", price: "$29 / month", features: ["Everything in Free", "Cloud-hosted workers", "Web dashboard", "Slack approval integration", "Email notifications", "Priority support"], cta: "Start free trial", ctaAction: () => navigate("/signup"), primary: true },
    { name: "Team", price: "$99 / month", features: ["Everything in Pro", "Shared team dashboard", "SSO / SAML", "Audit log export", "Custom worker templates", "Dedicated support"], cta: "Contact us", ctaHref: "mailto:team@nooterra.ai", primary: false },
  ];
  return (
    <div style={S.pricingWrap} className="lovable-fade">
      <h1 style={S.pricingTitle}>Simple, honest pricing</h1>
      <p style={{ fontSize: "1.05rem", color: "var(--text-secondary)", marginBottom: "3rem", maxWidth: 520, lineHeight: 1.6 }}>Start free with local workers. Upgrade when you want cloud hosting and team features.</p>
      {tiers.map((tier, i) => (
        <div key={tier.name} style={{ ...S.tier, borderBottom: i < tiers.length - 1 ? S.tier.borderBottom : "none" }}>
          <div>
            <div style={S.tierName}>{tier.name}</div>
            <div style={S.tierPrice}>{tier.price}</div>
            {tier.features.map((f, j) => <div key={j} style={S.tierFeature}>{f}</div>)}
          </div>
          <div style={{ paddingTop: "0.5rem" }}>
            {tier.ctaHref ? (
              <a href={tier.ctaHref} target={tier.ctaHref.startsWith("http") ? "_blank" : undefined} rel={tier.ctaHref.startsWith("http") ? "noopener noreferrer" : undefined} style={{ ...(tier.primary ? S.btnPrimary : S.btnSecondary), textDecoration: "none", display: "inline-flex", width: "auto" }}>{tier.cta}</a>
            ) : (
              <button style={{ ...(tier.primary ? S.btnPrimary : S.btnSecondary), width: "auto" }} onClick={tier.ctaAction}>{tier.cta}</button>
            )}
          </div>
        </div>
      ))}
      <div style={{ marginTop: "3rem" }}><a href="/" style={S.link} onClick={(e) => { e.preventDefault(); navigate("/"); }}>{"\u2190"} Back to home</a></div>
    </div>
  );
}


/* ===================================================================
   UserMenu
   =================================================================== */

function UserMenu({ onClose, onNavigate, onOpenSettings, userEmail, userTier, collapsed }) {
  const itemStyle = { display: "block", width: "100%", padding: "8px 14px", fontSize: "14px", color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", transition: "background 150ms" };
  const hover = (e) => { e.currentTarget.style.background = "var(--bg-hover)"; };
  const unhover = (e) => { e.currentTarget.style.background = "none"; };
  const sep = <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />;
  const popoverPosition = collapsed
    ? { position: "absolute", left: 56, bottom: 0 }
    : { position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 4 };
  return (
    <div className="popover-animate" style={{ ...popoverPosition, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-lg)", padding: "4px 0", zIndex: 100, minWidth: 220 }}>
      <div style={{ padding: "10px 14px 6px" }}>
        <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userEmail || "User"}</div>
        <div style={{ fontSize: "12px", color: tierColor(userTier), fontWeight: 600, marginTop: 2 }}>{tierLabel(userTier)} plan</div>
      </div>
      {sep}
      <button style={itemStyle} onMouseEnter={hover} onMouseLeave={unhover} onClick={() => { onClose(); onOpenSettings(); }}>Settings</button>
      <a href="https://docs.nooterra.ai" target="_blank" rel="noopener noreferrer" style={{ ...itemStyle, textDecoration: "none" }} onMouseEnter={hover} onMouseLeave={unhover} onClick={onClose}>Help & docs</a>
      {sep}
      <a href="/pricing" style={{ ...itemStyle, textDecoration: "none", color: "var(--accent)", fontWeight: 600 }} onMouseEnter={hover} onMouseLeave={unhover} onClick={(e) => { e.preventDefault(); onClose(); navigate("/pricing"); }}>Upgrade to Pro</a>
      {sep}
      <button style={itemStyle} onMouseEnter={hover} onMouseLeave={unhover} onClick={async () => { onClose(); await logoutSession(); try { localStorage.removeItem(PRODUCT_RUNTIME_STORAGE_KEY); } catch { /* ignore */ } try { localStorage.removeItem(ONBOARDING_STORAGE_KEY); } catch { /* ignore */ } navigate("/login"); }}>Log out</button>
    </div>
  );
}


/* ===================================================================
   AppShell
   =================================================================== */

function AppShell({ initialView = "home", userEmail, isFirstTime }) {
  const [view, setView] = useState(() => {
    // Default to builder (chat) — only go to inbox if user has active workers
    if (initialView !== "home" && initialView !== "builder") return initialView;
    return "builder";
  });
  const [selectedWorkerId, setSelectedWorkerId] = useState(null);
  const [isNewDeploy, setIsNewDeploy] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [workers, setWorkers] = useState([]);
  const [creditBalance, setCreditBalance] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userTier, setUserTier] = useState("free");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);

  useEffect(() => {
    function handleGlobalKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdPaletteOpen(prev => !prev);
      }
    }
    document.addEventListener("keydown", handleGlobalKey);
    return () => document.removeEventListener("keydown", handleGlobalKey);
  }, []);

  useEffect(() => {
    (async () => { try { const runtime = loadRuntimeConfig(); const result = await fetchApprovalInbox(runtime, { status: "pending" }); const items = result?.items || result || []; const count = Array.isArray(items) ? items.length : 0; setPendingApprovals(count); } catch { /* ignore */ } })();
    (async () => { try { const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); setWorkers(result?.items || result || []); } catch { /* ignore */ } })();
    (async () => { try { const result = await workerApiRequest({ pathname: "/v1/credits", method: "GET" }); if (result?.balance != null) setCreditBalance(result.balance); else if (result?.remaining != null) setCreditBalance(result.remaining); } catch { /* ignore */ } })();
    (async () => { try { const runtime = loadRuntimeConfig(); const settings = await fetchTenantSettings(runtime); if (settings?.tier) setUserTier(settings.tier); else if (settings?.plan) setUserTier(settings.plan); } catch { /* ignore */ } })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time approval feed via SSE
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    let es;
    try {
      es = new EventSource("/__nooterra/v1/approvals/feed");
      es.addEventListener("update", (e) => {
        try {
          const data = JSON.parse(e.data);
          if (typeof data.count === "number") {
            setPendingApprovals(data.count);
          }
          // Show toast for new approvals
          if (data.items && data.items.length > 0) {
            const newest = data.items[0];
            const workerName = newest.worker_name || newest.workerName || "A worker";
            const action = newest.tool_name || newest.action || "an action";
            setToasts(prev => [...prev, {
              id: Date.now(),
              message: `${workerName} wants to ${action}`,
            }]);
          }
        } catch { /* ignore parse errors */ }
      });
      es.addEventListener("snapshot", (e) => {
        try {
          const items = JSON.parse(e.data);
          if (Array.isArray(items)) setPendingApprovals(items.length);
        } catch { /* ignore */ }
      });
      es.onerror = () => {
        // SSE will auto-reconnect, no action needed
      };
    } catch { /* SSE not supported or endpoint unavailable */ }
    return () => { if (es) es.close(); };
  }, []);

  // Auto-redirect to inbox if workers have activity (only on initial load)
  const hasRedirected = useRef(false);
  useEffect(() => {
    if (hasRedirected.current || view !== "builder") return;
    const hasActiveWorkers = workers.some(w => w.status === "running" || w.lastRunAt || w.last_run_at || w.totalRuns > 0 || w.total_runs > 0);
    if (hasActiveWorkers) {
      hasRedirected.current = true;
      setView("inbox");
    }
  }, [workers]); // eslint-disable-line react-hooks/exhaustive-deps

  function refreshWorkers() {
    (async () => { try { const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); setWorkers(result?.items || result || []); } catch { /* ignore */ } })();
  }

  function handleNavigate(dest, workerId) {
    if (dest === "workerDetail" && workerId) { setSelectedWorkerId(workerId); setIsNewDeploy(false); setView("workerDetail"); }
    else { setView(dest); setSelectedWorkerId(null); setIsNewDeploy(false); }
  }
  function handleSelectWorker(worker) { setSelectedWorkerId(worker.id); setIsNewDeploy(false); setView("workerDetail"); }
  function handleBuilderComplete() { refreshWorkers(); setView("team"); }
  function handleViewWorker(w) { refreshWorkers(); if (w?.id) { setSelectedWorkerId(w.id); setIsNewDeploy(true); setView("workerDetail"); } else setView("team"); }

  // =============================================
  // ALL VIEWS: Sidebar + content
  // =============================================

  // --- Icons ---
  const iconEnvelope = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>;
  const iconPeople = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
  const iconPulse = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
  const iconChart = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>;
  const iconPlug = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>;
  const iconGear = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;

  const operateNav = [
    { key: "inbox", label: "Inbox", icon: iconEnvelope, badge: pendingApprovals },
    { key: "team", label: "Team", icon: iconPeople },
    { key: "activity", label: "Activity", icon: iconPulse },
  ];
  const manageNav = [
    { key: "performance", label: "Performance", icon: iconChart },
    { key: "connections", label: "Connections", icon: iconPlug },
    { key: "settings", label: "Settings", icon: iconGear, action: () => setSettingsOpen(true) },
  ];

  const sidebarActiveView = view === "workerDetail" ? "team" : (view === "approvals" ? "inbox" : view);

  // --- Sidebar nav item renderer ---
  function NavItem({ item }) {
    const active = sidebarActiveView === item.key;
    return (
      <button
        onClick={() => { if (item.action) item.action(); else navAndClose(item.key); }}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
          borderRadius: 8, border: "none", cursor: "pointer", width: "100%",
          fontFamily: "var(--font-body)", fontSize: "14px",
          fontWeight: active ? 600 : 400,
          color: active ? "var(--text-100)" : "var(--text-200)",
          background: active ? "var(--bg-100)" : "transparent",
          transition: "all 120ms", textAlign: "left",
        }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--bg-300, var(--bg-hover))"; }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = active ? "var(--bg-100)" : "transparent"; }}
      >
        <span style={{ flexShrink: 0, display: "flex" }}>{item.icon}</span>
        <span style={{ flex: 1 }}>{item.label}</span>
        {item.badge > 0 && (
          <span style={{
            fontSize: "11px", fontWeight: 700, color: "#fff",
            background: "var(--accent)", borderRadius: 10,
            padding: "1px 6px", minWidth: 18, textAlign: "center",
          }}>{item.badge}</span>
        )}
      </button>
    );
  }

  // --- Section label ---
  function SectionLabel({ children }) {
    return (
      <div style={{
        fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em",
        color: "var(--text-300)", fontFamily: "var(--font-mono)",
        padding: "16px 12px 4px",
      }}>{children}</div>
    );
  }

  // --- Determine what content shows ---
  const suspenseFallback = <div style={{ ...S.main, fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div>;
  function MainContent() {
    return (
      <React.Suspense fallback={suspenseFallback}>
        {view === "builder" ? <BuilderView onComplete={handleBuilderComplete} onViewWorker={handleViewWorker} userName={userEmail} isFirstTime={isFirstTime && workers.length === 0} />
        : view === "team" ? <div style={S.main}><WorkersListView onSelect={handleSelectWorker} onCreate={() => setView("builder")} /></div>
        : view === "workerDetail" && selectedWorkerId ? <div style={S.main}><WorkerDetailView workerId={selectedWorkerId} onBack={() => { setSelectedWorkerId(null); setIsNewDeploy(false); setView("team"); }} isNewDeploy={isNewDeploy} /></div>
        : view === "inbox" || view === "approvals" ? <div style={S.main}><InboxView /></div>
        : view === "activity" || view === "receipts" ? <div style={S.main}><ReceiptsView /></div>
        : view === "performance" ? <div style={S.main}><PerformanceView /></div>
        : view === "connections" || view === "integrations" ? <div style={S.main}><IntegrationsView /></div>
        : <div style={S.main}><WorkersListView onSelect={handleSelectWorker} onCreate={() => setView("builder")} /></div>}
      </React.Suspense>
    );
  }

  // Close mobile menu when navigating
  const navAndClose = (dest) => { handleNavigate(dest); setMobileMenuOpen(false); };

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-100)", overflow: "hidden" }}>

      {/* ===== MOBILE HEADER BAR ===== */}
      <div className="mobile-topbar" style={{
        display: "none", position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        height: 48, background: "var(--bg-400)", borderBottom: "1px solid var(--border)",
        alignItems: "center", padding: "0 12px", justifyContent: "space-between",
      }}>
        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} style={{
          background: "none", border: "none", cursor: "pointer", color: "var(--text-200)",
          padding: 8, display: "flex", alignItems: "center",
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <img src="/nooterra-logo.png" alt="nooterra" style={{ height: 16 }} />
        <div style={{ width: 36 }} />
      </div>

      {/* ===== MOBILE OVERLAY ===== */}
      {mobileMenuOpen && (
        <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)} style={{
          display: "none", position: "fixed", inset: 0, zIndex: 199,
          background: "rgba(0,0,0,0.4)",
        }} />
      )}

      {/* ===== LEFT SIDEBAR ===== */}
      <aside className="app-sidebar" style={{
        width: 240, flexShrink: 0, background: "var(--bg-400)",
        borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column",
        height: "100vh", overflow: "hidden",
        ...(mobileMenuOpen ? { position: "fixed", top: 0, left: 0, zIndex: 200, boxShadow: "4px 0 20px rgba(0,0,0,0.15)" } : {}),
      }}>
      <style>{`
        @media (max-width: 768px) {
          .mobile-topbar { display: flex !important; }
          .mobile-overlay { display: block !important; }
          .app-sidebar { display: ${mobileMenuOpen ? "flex" : "none"} !important; position: fixed !important; top: 0; left: 0; z-index: 200; box-shadow: 4px 0 20px rgba(0,0,0,0.15); }
          .app-main-content { margin-top: 48px; }
        }
      `}</style>
        {/* Logo */}
        <div style={{ padding: "16px 16px 12px", display: "flex", alignItems: "center" }}>
          <img src="/nooterra-logo.png" alt="nooterra" style={{ height: 18 }} />
        </div>

        {/* New team button */}
        <div style={{ padding: "0 12px 8px" }}>
          <button
            onClick={() => { setView("builder"); setMobileMenuOpen(false); }}
            style={{
              width: "100%", padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)",
              background: "transparent", color: "var(--text-200)", fontSize: "13px", fontWeight: 500,
              cursor: "pointer", fontFamily: "var(--font-body)", transition: "all 120ms",
              display: "flex", alignItems: "center", gap: 6, justifyContent: "center",
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New worker
          </button>
        </div>

        {/* Nav sections */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 4px" }}>
          <SectionLabel>Operate</SectionLabel>
          {operateNav.map(item => <NavItem key={item.key} item={item} />)}

          <SectionLabel>Manage</SectionLabel>
          {manageNav.map(item => <NavItem key={item.key} item={item} />)}
        </div>

        {/* Bottom: user */}
        <div style={{ borderTop: "1px solid var(--border)", padding: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: "50%", background: "var(--accent)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "12px", fontWeight: 700, color: "#fff", flexShrink: 0,
            }}>
              {getInitials(userEmail)}
            </div>
            <div style={{ overflow: "hidden", flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "13px", color: "var(--text-100)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userEmail || "User"}</div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: tierColor(userTier) }}>{tierLabel(userTier)}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ===== MAIN CONTENT ===== */}
      <main className="app-main-content" style={{
        flex: 1, display: "flex", flexDirection: "column", minWidth: 0,
        background: "var(--bg-100)", height: "100vh", overflow: "auto",
      }}>
        <div key={view} className="view-enter">
          <MainContent />
        </div>
      </main>

      {settingsOpen && <SettingsModal userEmail={userEmail} userTier={userTier} creditBalance={creditBalance} onClose={() => setSettingsOpen(false)} />}

      <CommandPalette
        open={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        workers={workers}
        onNavigate={(dest) => {
          if (dest === "settings") setSettingsOpen(true);
          else navAndClose(dest);
        }}
        onSelectWorker={handleSelectWorker}
        onToggleTheme={() => {
          const current = loadTheme();
          const next = current === "dark" ? "light" : "dark";
          saveTheme(next);
        }}
      />

      {toasts.map(toast => (
        <ToastNotification
          key={toast.id}
          message={toast.message}
          onClose={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
          onClick={() => { setToasts(prev => prev.filter(t => t.id !== toast.id)); navAndClose("inbox"); }}
        />
      ))}
    </div>
  );
}


/* ===================================================================
   ProductShell -- top-level mode router
   =================================================================== */

export default function ProductShell({ mode, launchId, agentId, runId, requestedPath }) {
  const [currentMode, setCurrentMode] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [userEmail, setUserEmail] = useState(null);
  const [isFirstTime, setIsFirstTime] = useState(false);

  useEffect(() => { applyTheme(loadTheme()); }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkSession() {
      if (mode === "signup" || mode === "pricing") { setCurrentMode(mode); setSessionChecked(true); return; }
      try {
        const principal = await fetchSessionPrincipal();
        if (!cancelled && principal && principal.email) {
          setUserEmail(principal.email);
          const runtime = loadRuntimeConfig();
          if (principal.tenantId) saveRuntime({ ...runtime, tenantId: principal.tenantId });
          saveOnboardingState({ ...loadOnboardingState(), buyer: principal, sessionExpected: true, completed: true });
          try { const workersResult = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); if ((workersResult?.items || workersResult || []).length === 0) setIsFirstTime(true); } catch { /* ignore */ }
          if (mode === "login" || mode === "signup") setCurrentMode("dashboard"); else setCurrentMode(mode || "dashboard");
          setSessionChecked(true); return;
        }
      } catch { /* No valid session */ }
      if (!cancelled) {
        if (mode === "login" || mode === "signup" || mode === "pricing") setCurrentMode(mode); else setCurrentMode("login");
        setSessionChecked(true);
      }
    }
    checkSession();
    return () => { cancelled = true; };
  }, [mode]);

  useEffect(() => {
    if (sessionChecked) {
      const onboardState = loadOnboardingState();
      if (onboardState?.sessionExpected) setCurrentMode(mode);
      else if (mode === "signup" || mode === "login" || mode === "pricing") setCurrentMode(mode);
    }
  }, [mode, sessionChecked]);

  function handleAuth() { window.location.href = "/dashboard"; }

  if (!sessionChecked) {
    return (
      <div style={S.shell}>
        <div style={S.authWrap}>
          <div style={{ textAlign: "center" }}>
            <NooterraLogo height={24} style={{ color: "var(--text-primary)", margin: "0 auto 0.75rem" }} />
            <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  const resolvedMode = currentMode;

  function getInitialView() {
    switch (resolvedMode) {
      case "approvals": return "approvals";
      case "receipts": return "receipts";
      case "workspace": return "settings";
      case "integrations": return "connections";
      default: return "builder";
    }
  }

  return (
    <div style={S.shell}>
      {(resolvedMode === "signup" || resolvedMode === "login") && <React.Suspense fallback={<div style={S.authWrap}><div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div></div>}><AuthView onAuth={handleAuth} /></React.Suspense>}
      {resolvedMode === "pricing" && <PricingView />}
      {!["signup", "login", "pricing"].includes(resolvedMode) && resolvedMode != null && (
        <AppShell initialView={getInitialView()} userEmail={userEmail} isFirstTime={isFirstTime} />
      )}
    </div>
  );
}
