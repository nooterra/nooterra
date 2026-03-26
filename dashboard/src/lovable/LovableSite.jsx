import { useEffect, useState } from "react";
import { ossLinks } from "../site/config/links.js";

const DOCS_EXTERNAL = "https://docs.nooterra.ai";
const DOCS_GETTING_STARTED = DOCS_EXTERNAL + "/getting-started";
const DISCORD_HREF = "https://discord.gg/nooterra";
const MANAGED_ONBOARDING_HREF = buildManagedAccountHref({ flow: "signup", source: "site", hash: "account-create" });
const MANAGED_LOGIN_HREF = buildManagedAccountHref({ flow: "login", source: "site", hash: "identity-access" });

function buildManagedAccountHref({ flow = "signup", source = "", hash = "account-create" } = {}) {
  const params = new URLSearchParams();
  params.set("experience", "app");
  const normalizedSource = String(source ?? "").trim();
  if (normalizedSource) params.set("source", normalizedSource);
  const normalizedHash = String(hash ?? "").trim().replace(/^#?/, "");
  return `/${String(flow ?? "signup").trim() || "signup"}?${params.toString()}${normalizedHash ? `#${normalizedHash}` : ""}`;
}

function buildManagedOnboardingHref(source) {
  return buildManagedAccountHref({ flow: "signup", source, hash: "account-create" });
}

/* ── Inline logo SVG ── */

function NooterraLogo({ className = "" }) {
  return (
    <svg viewBox="0 0 2172 724" className={className} fill="currentColor">
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

/* ── GitHub icon ── */

function GitHubIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/* ── Shared layout ── */

function FadeIn({ children, delay = 0, className = "" }) {
  return (
    <div className={`lovable-fade ${className}`.trim()} style={{ animationDelay: `${delay}s` }}>
      {children}
    </div>
  );
}

function SiteNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pathname, setPathname] = useState(typeof window === "undefined" ? "/" : window.location.pathname);

  useEffect(() => {
    const handleChange = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handleChange);
    return () => window.removeEventListener("popstate", handleChange);
  }, []);

  const navLinks = [
    { label: "Docs", href: DOCS_EXTERNAL },
    { label: "Pricing", href: "/pricing" },
    { label: "GitHub", href: ossLinks.repo }
  ];

  return (
    <nav className="fixed inset-x-0 top-0 z-50" style={{ backgroundColor: "rgba(13, 12, 10, 0.92)", backdropFilter: "blur(12px)" }}>
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <a href="/" className="flex items-center gap-2 group">
          <img src="/logo.png" alt="nooterra" style={{ height: 40, width: "auto", mixBlendMode: "screen" }} />
        </a>

        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[13px] font-medium transition-colors duration-150"
              style={{ color: pathname === link.href ? "var(--neutral-200)" : "var(--neutral-500)" }}
              onMouseEnter={(e) => e.currentTarget.style.color = "var(--neutral-200)"}
              onMouseLeave={(e) => { if (pathname !== link.href) e.currentTarget.style.color = "var(--neutral-500)"; }}
              {...(link.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {link.label}
            </a>
          ))}
          <a
            href="/login"
            className="text-[13px] transition-colors"
            style={{ color: "var(--neutral-500)" }}
            onMouseEnter={(e) => e.currentTarget.style.color = "var(--neutral-200)"}
            onMouseLeave={(e) => e.currentTarget.style.color = "var(--neutral-500)"}
          >
            Sign in
          </a>
          <a
            href="/signup"
            className="inline-flex items-center px-3.5 py-1.5 text-[13px] font-semibold transition-all duration-150"
            style={{ backgroundColor: "var(--gold)", color: "var(--neutral-950)", borderRadius: "6px" }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--gold-hover)"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "var(--gold)"}
          >
            Get started
          </a>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="p-2 md:hidden"
          style={{ color: "var(--neutral-400)" }}
          aria-label="Toggle menu"
        >
          {mobileOpen ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/></svg>
          )}
        </button>
      </div>

      {mobileOpen ? (
        <div className="md:hidden" style={{ borderTop: "1px solid rgba(235, 232, 226, 0.06)", backgroundColor: "rgba(13, 12, 10, 0.96)", backdropFilter: "blur(12px)" }}>
          <div className="space-y-3 px-6 py-5">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="block text-sm transition-colors"
                style={{ color: "var(--neutral-400)" }}
              >
                {link.label}
              </a>
            ))}
            <div className="pt-2 flex items-center gap-4">
              <a
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="text-sm transition-colors"
                style={{ color: "var(--neutral-500)" }}
              >
                Sign in
              </a>
              <a
                href="/signup"
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center px-3.5 py-1.5 text-sm font-semibold"
                style={{ backgroundColor: "var(--gold)", color: "var(--neutral-950)", borderRadius: "6px" }}
              >
                Get started
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </nav>
  );
}

function SiteFooter() {
  return (
    <footer>
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div style={{ height: "1px", background: "linear-gradient(90deg, transparent, rgba(235, 232, 226, 0.08) 20%, rgba(235, 232, 226, 0.08) 80%, transparent)", marginBottom: "40px" }} />
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div>
            <NooterraLogo className="h-4 w-auto" style={{ color: "var(--neutral-300)" }} />
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed" style={{ color: "var(--neutral-600)" }}>
              AI workers for consequential work.
            </p>
            <p className="mt-6 text-[11px]" style={{ color: "var(--neutral-700)" }}>&copy; 2026 Nooterra</p>
          </div>
          <div className="flex flex-wrap gap-x-14 gap-y-6">
            <div className="space-y-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em]" style={{ color: "var(--neutral-600)" }}>Resources</p>
              <a href={DOCS_EXTERNAL} className="block text-[13px] transition-colors hover:opacity-80" style={{ color: "var(--neutral-500)" }} target="_blank" rel="noopener noreferrer">Docs</a>
              <a href={ossLinks.repo} className="block text-[13px] transition-colors hover:opacity-80" style={{ color: "var(--neutral-500)" }} target="_blank" rel="noopener noreferrer">GitHub</a>
              <a href={DISCORD_HREF} className="block text-[13px] transition-colors hover:opacity-80" style={{ color: "var(--neutral-500)" }} target="_blank" rel="noopener noreferrer">Discord</a>
            </div>
            <div className="space-y-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em]" style={{ color: "var(--neutral-600)" }}>Legal</p>
              <a href="/security" className="block text-[13px] transition-colors hover:opacity-80" style={{ color: "var(--neutral-500)" }}>Security</a>
              <a href="/privacy" className="block text-[13px] transition-colors hover:opacity-80" style={{ color: "var(--neutral-500)" }}>Privacy</a>
              <a href="/terms" className="block text-[13px] transition-colors hover:opacity-80" style={{ color: "var(--neutral-500)" }}>Terms</a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

function SiteLayout({ children }) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--neutral-950)", color: "var(--neutral-300)", fontFamily: "var(--font-body)" }}>
      <SiteNav />
      <main className="pt-14">{children}</main>
      <SiteFooter />
    </div>
  );
}

/* ── Animated worker card ── */

const WORKER_STEPS = [
  { label: "Read customer email", status: "done" },
  { label: "Look up account in Stripe", status: "done" },
  { label: "Draft refund reply", status: "done" },
  { label: "Issue $49 refund", status: "approval" },
];

function WorkerCard() {
  const [step, setStep] = useState(0);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    if (step >= WORKER_STEPS.length) return;
    const delay = step === 0 ? 800 : WORKER_STEPS[step].status === "approval" ? 1200 : 700;
    const timer = setTimeout(() => setStep(s => s + 1), delay);
    return () => clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    if (step >= WORKER_STEPS.length && !approved) {
      const timer = setTimeout(() => setApproved(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [step, approved]);

  const checkSvg = (color) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );

  return (
    <div style={{ border: "1px solid rgba(235, 232, 226, 0.06)", borderRadius: "10px", backgroundColor: "rgba(235, 232, 226, 0.02)", overflow: "hidden" }}>
      {/* Worker header */}
      <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid rgba(235, 232, 226, 0.04)" }}>
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full lovable-pulse" style={{ backgroundColor: "#4ade80" }} />
          <span className="text-[13px] font-semibold" style={{ color: "var(--neutral-100)" }}>Customer Support Worker</span>
        </div>
        <span className="text-[11px] tabular-nums" style={{ color: "var(--neutral-600)" }}>running</span>
      </div>

      {/* Activity */}
      <div className="px-5 py-4 space-y-3">
        {WORKER_STEPS.slice(0, step).map((s, i) => (
          <div key={i} className="flex items-center gap-3" style={{ animation: "lovable-fade-in 0.3s ease forwards" }}>
            {s.status === "done" ? (
              checkSvg("#4ade80")
            ) : approved ? (
              checkSvg("var(--gold)")
            ) : (
              <div className="h-3.5 w-3.5 shrink-0 rounded-full animate-pulse" style={{ border: "2px solid #f59e0b" }} />
            )}
            <span className="text-[13px]" style={{ color: s.status === "approval" && !approved ? "#fbbf24" : "var(--neutral-400)" }}>
              {s.label}
            </span>
            {s.status === "approval" && !approved ? (
              <span className="ml-auto px-2 py-0.5 text-[10px] uppercase tracking-wider font-medium" style={{ borderRadius: "9999px", border: "1px solid rgba(245, 158, 11, 0.3)", backgroundColor: "rgba(245, 158, 11, 0.1)", color: "#fbbf24" }}>
                needs approval
              </span>
            ) : s.status === "approval" && approved ? (
              <span className="ml-auto px-2 py-0.5 text-[10px] uppercase tracking-wider font-medium" style={{ borderRadius: "9999px", border: "1px solid rgba(74, 222, 128, 0.3)", backgroundColor: "rgba(74, 222, 128, 0.1)", color: "#4ade80" }}>
                approved
              </span>
            ) : null}
          </div>
        ))}
        {step < WORKER_STEPS.length ? (
          <div className="flex items-center gap-3">
            <div className="h-3.5 w-3.5 shrink-0 rounded-full animate-pulse" style={{ border: "1px solid rgba(235, 232, 226, 0.1)" }} />
            <span className="text-[13px]" style={{ color: "var(--neutral-600)" }}>Working...</span>
          </div>
        ) : null}
      </div>

      {/* Charter summary */}
      <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(235, 232, 226, 0.04)" }}>
        <div className="flex flex-wrap gap-4 text-[11px] tabular-nums">
          <span style={{ color: "rgba(74, 222, 128, 0.7)" }}>4 canDo</span>
          <span style={{ color: "rgba(245, 158, 11, 0.7)" }}>3 askFirst</span>
          <span style={{ color: "rgba(244, 63, 94, 0.7)" }}>2 neverDo</span>
          <span className="ml-auto" style={{ color: "var(--neutral-600)" }}>$0.003 this run</span>
        </div>
      </div>
    </div>
  );
}

/* ── HOME PAGE ── */

function HomePage() {
  return (
    <SiteLayout>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="relative mx-auto max-w-6xl px-6" style={{ paddingTop: "clamp(6rem, 12vh, 10rem)", paddingBottom: "clamp(5rem, 10vh, 8rem)" }}>
          <div className="grid items-center gap-16 lg:grid-cols-2">
            <div>
              <FadeIn>
                <h1 style={{ fontSize: "clamp(2.25rem, 5vw, 3.75rem)", lineHeight: 1.06, letterSpacing: "-0.03em", fontWeight: 700, color: "var(--neutral-100)" }}>
                  Your next hire never sleeps.
                </h1>
              </FadeIn>
              <FadeIn delay={0.08}>
                <p className="mt-7 max-w-md" style={{ fontSize: "clamp(1rem, 1.5vw, 1.125rem)", lineHeight: 1.65, color: "var(--neutral-500)" }}>
                  AI workers that handle real work -- with rules, approvals, and a complete audit trail.
                </p>
              </FadeIn>
              <FadeIn delay={0.14}>
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <a
                    href={DOCS_GETTING_STARTED}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-[14px] font-semibold transition-all duration-150"
                    style={{ backgroundColor: "var(--gold)", color: "var(--neutral-950)", borderRadius: "6px" }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--gold-hover)"}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "var(--gold)"}
                    target="_blank" rel="noopener noreferrer"
                  >
                    Get started
                  </a>
                  <a
                    href={ossLinks.repo}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-[14px] font-medium transition-all duration-150"
                    style={{ border: "1px solid rgba(235, 232, 226, 0.1)", color: "var(--neutral-400)", borderRadius: "6px" }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(235, 232, 226, 0.18)"; e.currentTarget.style.color = "var(--neutral-200)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(235, 232, 226, 0.1)"; e.currentTarget.style.color = "var(--neutral-400)"; }}
                    target="_blank" rel="noopener noreferrer"
                  >
                    <GitHubIcon className="h-4 w-4" /> View on GitHub
                  </a>
                </div>
              </FadeIn>
            </div>
            <FadeIn delay={0.2}>
              <div className="relative lg:pl-6">
                <WorkerCard />
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Section 1: You describe it. It runs. */}
      <section>
        <div className="mx-auto max-w-6xl px-6" style={{ paddingTop: "5rem", paddingBottom: "5rem" }}>
          <div style={{ height: "1px", background: "linear-gradient(90deg, transparent, rgba(235, 232, 226, 0.07) 20%, rgba(235, 232, 226, 0.07) 80%, transparent)", marginBottom: "5rem" }} />
          <div className="grid gap-14 md:grid-cols-2 items-center">
            <FadeIn>
              <div>
                <h2 style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)", letterSpacing: "-0.02em", fontWeight: 700, color: "var(--neutral-100)" }}>
                  You describe it. It runs.
                </h2>
                <p className="mt-5 text-[15px] leading-relaxed" style={{ color: "var(--neutral-500)" }}>
                  Tell Nooterra what you need in plain English. It builds the worker, infers the tools, sets the schedule, and generates a charter you can review before anything runs.
                </p>
              </div>
            </FadeIn>
            <FadeIn delay={0.12}>
              <WorkerCard />
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Section 2: Rules it can't break. */}
      <section>
        <div className="mx-auto max-w-6xl px-6" style={{ paddingTop: "5rem", paddingBottom: "5rem" }}>
          <div style={{ height: "1px", background: "linear-gradient(90deg, transparent, rgba(235, 232, 226, 0.07) 20%, rgba(235, 232, 226, 0.07) 80%, transparent)", marginBottom: "5rem" }} />
          <div className="grid gap-14 md:grid-cols-2 items-start">
            <FadeIn>
              <h2 style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)", letterSpacing: "-0.02em", fontWeight: 700, color: "var(--neutral-100)" }}>
                Rules it can't break.
              </h2>
              <p className="mt-5 text-[15px] leading-relaxed" style={{ color: "var(--neutral-500)" }}>
                Every worker gets a charter with three rule types. These aren't prompt suggestions -- they're enforced at runtime before every action.
              </p>
              <div className="mt-10 space-y-6">
                {[
                  { dot: "#4ade80", label: "canDo", desc: "Actions the worker takes autonomously. Read data, send alerts, update records." },
                  { dot: "#fbbf24", label: "askFirst", desc: "Actions that pause and wait for your approval. Refunds, external emails, spending." },
                  { dot: "#f43f5e", label: "neverDo", desc: "Hard blocks the worker cannot cross, no matter what. Enforced at runtime." }
                ].map((item) => (
                  <div key={item.label} className="flex items-start gap-4">
                    <div className="mt-2 h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.dot }} />
                    <div>
                      <span className="text-[13px] font-bold" style={{ color: "var(--neutral-200)", fontFamily: "monospace" }}>{item.label}</span>
                      <p className="mt-1 text-[14px] leading-relaxed" style={{ color: "var(--neutral-500)" }}>{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </FadeIn>
            <FadeIn delay={0.12}>
              <div style={{ border: "1px solid rgba(235, 232, 226, 0.06)", borderRadius: "10px", overflow: "hidden" }}>
                <div className="px-5 py-3.5 flex items-center gap-3" style={{ borderBottom: "1px solid rgba(235, 232, 226, 0.04)" }}>
                  <span className="text-[13px] font-semibold" style={{ color: "var(--neutral-200)" }}>Customer Support Worker</span>
                  <span className="ml-auto text-[11px]" style={{ color: "var(--neutral-600)" }}>charter</span>
                </div>
                <div className="p-5 space-y-5">
                  <div>
                    <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "rgba(74, 222, 128, 0.7)" }}>Can do</p>
                    <div className="space-y-2">
                      {["Read customer emails", "Look up billing in Stripe", "Draft reply messages", "Search FAQ and knowledge base"].map(r => (
                        <div key={r} className="flex items-center gap-3">
                          <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: "#4ade80" }} />
                          <span className="text-[13px]" style={{ color: "var(--neutral-400)" }}>{r}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "rgba(251, 191, 36, 0.7)" }}>Ask first</p>
                    <div className="space-y-2">
                      {["Issue refunds over $10", "Send emails to customers", "Make promises about features"].map(r => (
                        <div key={r} className="flex items-center gap-3">
                          <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: "#fbbf24" }} />
                          <span className="text-[13px]" style={{ color: "var(--neutral-400)" }}>{r}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "rgba(244, 63, 94, 0.7)" }}>Never do</p>
                    <div className="space-y-2">
                      {["Share customer data between customers", "Make up information", "Delete any records"].map(r => (
                        <div key={r} className="flex items-center gap-3">
                          <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: "#f43f5e" }} />
                          <span className="text-[13px]" style={{ color: "var(--neutral-400)" }}>{r}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Section 3: Bold outcome claim */}
      <section>
        <div className="mx-auto max-w-6xl px-6" style={{ paddingTop: "5rem", paddingBottom: "5rem" }}>
          <div style={{ height: "1px", background: "linear-gradient(90deg, transparent, rgba(235, 232, 226, 0.07) 20%, rgba(235, 232, 226, 0.07) 80%, transparent)", marginBottom: "5rem" }} />
          <FadeIn>
            <div className="text-center" style={{ maxWidth: "36rem", margin: "0 auto" }}>
              <h2 style={{ fontSize: "clamp(1.75rem, 4vw, 2.75rem)", letterSpacing: "-0.03em", fontWeight: 700, color: "var(--neutral-100)", lineHeight: 1.15 }}>
                One worker handles 127 requests a week.
              </h2>
              <p className="mt-6 text-[15px] leading-relaxed" style={{ color: "var(--neutral-500)" }}>
                Runs 24/7 as a real daemon. Cron schedules, crash recovery, auto-restart. Every action logged, every decision auditable. Your keys, any provider.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Section 4: One-line comparison */}
      <section>
        <div className="mx-auto max-w-6xl px-6" style={{ paddingTop: "3rem", paddingBottom: "5rem" }}>
          <div style={{ height: "1px", background: "linear-gradient(90deg, transparent, rgba(235, 232, 226, 0.07) 20%, rgba(235, 232, 226, 0.07) 80%, transparent)", marginBottom: "5rem" }} />
          <FadeIn>
            <div className="text-center">
              <p style={{ fontSize: "clamp(1.125rem, 2vw, 1.375rem)", lineHeight: 1.65, color: "var(--neutral-400)", fontWeight: 500, letterSpacing: "-0.01em" }}>
                Unlike chatbots, workers take action. Unlike automation, they think.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Section 5: Start in 30 seconds */}
      <section>
        <div className="mx-auto max-w-6xl px-6" style={{ paddingTop: "3rem", paddingBottom: "5rem" }}>
          <div style={{ height: "1px", background: "linear-gradient(90deg, transparent, rgba(235, 232, 226, 0.07) 20%, rgba(235, 232, 226, 0.07) 80%, transparent)", marginBottom: "5rem" }} />
          <FadeIn>
            <div className="text-center" style={{ maxWidth: "32rem", margin: "0 auto" }}>
              <h2 style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)", letterSpacing: "-0.02em", fontWeight: 700, color: "var(--neutral-100)" }}>
                Start in 30 seconds.
              </h2>
              <div className="mt-8">
                <a
                  href="/signup"
                  className="inline-flex items-center gap-2 px-6 py-3 text-[14px] font-semibold transition-all duration-150"
                  style={{ backgroundColor: "var(--gold)", color: "var(--neutral-950)", borderRadius: "8px", width: "100%", justifyContent: "center" }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--gold-hover)"}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "var(--gold)"}
                >
                  Describe your first worker
                </a>
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                {["Customer support", "Price tracking", "Inbox summary"].map((t) => (
                  <span
                    key={t}
                    className="px-3 py-1.5 text-[12px]"
                    style={{ borderRadius: "9999px", border: "1px solid rgba(235, 232, 226, 0.08)", color: "var(--neutral-500)" }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* CTA */}
      <section>
        <div className="mx-auto max-w-6xl px-6" style={{ paddingTop: "4rem", paddingBottom: "8rem" }}>
          <div style={{ height: "1px", background: "linear-gradient(90deg, transparent, rgba(235, 232, 226, 0.07) 20%, rgba(235, 232, 226, 0.07) 80%, transparent)", marginBottom: "6rem" }} />
          <FadeIn>
            <div className="text-center">
              <h2 style={{ fontSize: "clamp(1.75rem, 4vw, 2.5rem)", letterSpacing: "-0.03em", fontWeight: 700, color: "var(--neutral-100)" }}>
                Your next worker is one conversation away.
              </h2>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <a
                  href="/signup"
                  className="inline-flex items-center gap-2 px-6 py-2.5 text-[14px] font-semibold transition-all duration-150"
                  style={{ backgroundColor: "var(--gold)", color: "var(--neutral-950)", borderRadius: "6px" }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--gold-hover)"}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "var(--gold)"}
                >
                  Get started
                </a>
                <a
                  href={ossLinks.repo}
                  className="inline-flex items-center gap-2 px-6 py-2.5 text-[14px] font-medium transition-all duration-150"
                  style={{ border: "1px solid rgba(235, 232, 226, 0.1)", color: "var(--neutral-400)", borderRadius: "6px" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(235, 232, 226, 0.18)"; e.currentTarget.style.color = "var(--neutral-200)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(235, 232, 226, 0.1)"; e.currentTarget.style.color = "var(--neutral-400)"; }}
                  target="_blank" rel="noopener noreferrer"
                >
                  View on GitHub
                </a>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>
    </SiteLayout>
  );
}

/* ── SECURITY PAGE ── */

function SecurityPage() {
  return (
    <SiteLayout>
      <section className="mx-auto max-w-6xl px-6" style={{ paddingTop: "7rem", paddingBottom: "3rem" }}>
        <FadeIn>
          <h1 style={{ fontSize: "clamp(2rem, 4vw, 2.75rem)", letterSpacing: "-0.03em", fontWeight: 700, color: "var(--neutral-100)" }}>Security</h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed" style={{ color: "var(--neutral-500)" }}>
            Workers cannot exceed their charter. Every action is logged. Every escalation requires human approval. Every boundary is enforced at runtime.
          </p>
        </FadeIn>
      </section>

      <section className="mx-auto max-w-6xl px-6" style={{ paddingBottom: "6rem" }}>
        <div className="mt-10 space-y-0">
          {[
            { title: "Fail closed", desc: "Ambiguous situations halt execution and ask. Missing context, unclear scope, or expired approvals all stop the worker." },
            { title: "Least privilege", desc: "Workers only access tools and data explicitly granted in their charter. Nothing more." },
            { title: "Human in the loop", desc: "Consequential actions always route through human approval. The threshold is configurable per worker." },
            { title: "Full audit trail", desc: "Every action, approval, and decision logged with timestamps and context. Export anytime." }
          ].map((item, i) => (
            <FadeIn key={item.title} delay={i * 0.06}>
              <div className="py-8" style={i > 0 ? { borderTop: "1px solid rgba(235, 232, 226, 0.05)" } : {}}>
                <h3 className="text-[15px] font-semibold" style={{ color: "var(--neutral-100)" }}>{item.title}</h3>
                <p className="mt-2 max-w-lg text-[14px] leading-relaxed" style={{ color: "var(--neutral-500)" }}>{item.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}

/* ── SIMPLE PAGES ── */

function SimplePage({ title, children }) {
  return (
    <SiteLayout>
      <section className="mx-auto max-w-6xl px-6" style={{ paddingTop: "7rem", paddingBottom: "3rem" }}>
        <FadeIn>
          <h1 style={{ fontSize: "clamp(2rem, 4vw, 2.75rem)", letterSpacing: "-0.03em", fontWeight: 700, color: "var(--neutral-100)" }}>{title}</h1>
        </FadeIn>
      </section>
      <section className="mx-auto max-w-6xl px-6" style={{ paddingBottom: "6rem" }}>
        <FadeIn delay={0.06}>{children}</FadeIn>
      </section>
    </SiteLayout>
  );
}

function PrivacyPage() {
  return (
    <SimplePage title="Privacy">
      <div className="space-y-0">
        {[
          { title: "Your keys, your providers", desc: "API keys are encrypted at rest and never leave your account boundary. Free tier runs entirely on your machine." },
          { title: "No training on your data", desc: "We never train models on your data. Audit logs are yours -- exportable and deletable." },
          { title: "Data portability", desc: "Export workers, charters, and logs at any time. Cancel and your data is deleted within 30 days." }
        ].map((item, i) => (
          <div key={item.title} className="py-8" style={i > 0 ? { borderTop: "1px solid rgba(235, 232, 226, 0.05)" } : {}}>
            <h3 className="text-[15px] font-semibold" style={{ color: "var(--neutral-100)" }}>{item.title}</h3>
            <p className="mt-2 max-w-lg text-[14px] leading-relaxed" style={{ color: "var(--neutral-500)" }}>{item.desc}</p>
          </div>
        ))}
      </div>
    </SimplePage>
  );
}

function TermsPage() {
  return (
    <SimplePage title="Terms">
      <div className="space-y-0">
        {[
          { title: "Your workers, your responsibility", desc: "You define the charter, grant approvals, and control what workers do. Nooterra enforces the boundaries you set." },
          { title: "Fair use", desc: "Workers should perform legitimate business tasks. Do not use for spam, fraud, or harassment." },
          { title: "Service availability", desc: "Free tier runs locally with no uptime guarantee. Paid tiers include SLAs." }
        ].map((item, i) => (
          <div key={item.title} className="py-8" style={i > 0 ? { borderTop: "1px solid rgba(235, 232, 226, 0.05)" } : {}}>
            <h3 className="text-[15px] font-semibold" style={{ color: "var(--neutral-100)" }}>{item.title}</h3>
            <p className="mt-2 max-w-lg text-[14px] leading-relaxed" style={{ color: "var(--neutral-500)" }}>{item.desc}</p>
          </div>
        ))}
      </div>
    </SimplePage>
  );
}

function SupportPage() {
  return (
    <SimplePage title="Get help">
      <div className="space-y-0">
        {[
          { title: "Documentation", desc: "Guides, API reference, and troubleshooting.", href: DOCS_EXTERNAL, cta: "Open docs" },
          { title: "Discord", desc: "Ask questions and get help from the community.", href: DISCORD_HREF, cta: "Join Discord" },
          { title: "GitHub Issues", desc: "Report bugs or request features.", href: ossLinks.issues, cta: "Open issue" }
        ].map((item, i) => (
          <a key={item.title} href={item.href} className="block py-8 transition-colors group" style={i > 0 ? { borderTop: "1px solid rgba(235, 232, 226, 0.05)" } : {}} target="_blank" rel="noopener noreferrer">
            <h3 className="text-[15px] font-semibold" style={{ color: "var(--neutral-100)" }}>{item.title}</h3>
            <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--neutral-500)" }}>{item.desc}</p>
            <span className="mt-2 inline-block text-[13px] transition-colors" style={{ color: "var(--neutral-400)" }}>{item.cta} &rarr;</span>
          </a>
        ))}
      </div>
    </SimplePage>
  );
}

/* ── STATUS PAGE ── */

const PUBLIC_STATUS_CHECKS = Object.freeze([
  { id: "home", label: "Homepage", path: "/", type: "html", needle: "conversation" }
]);

function normalizeStatusPathname(value) {
  if (typeof window === "undefined") return "";
  try { return new URL(String(value ?? "/"), window.location.origin).pathname || "/"; } catch { return ""; }
}

async function probePublicHtmlRoute(check, { timeoutMs = 8000, intervalMs = 250 } = {}) {
  if (typeof window === "undefined" || !window.document?.body) {
    return { ...check, status: "unavailable", statusLabel: "Unavailable", detail: "Requires browser" };
  }
  return new Promise((resolve) => {
    const iframe = window.document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    Object.assign(iframe.style, { position: "fixed", width: "1px", height: "1px", opacity: "0", pointerEvents: "none", border: "0" });
    const expectedPathname = normalizeStatusPathname(check.path);
    let settled = false, intervalId = null, timeoutId = null, lastState = {};
    const cleanup = () => { if (intervalId) clearInterval(intervalId); if (timeoutId) clearTimeout(timeoutId); iframe.remove(); };
    const finish = (result) => { if (settled) return; settled = true; cleanup(); resolve({ ...check, ...result }); };
    const readState = () => {
      try {
        const fd = iframe.contentDocument;
        lastState = { pathname: iframe.contentWindow?.location?.pathname ?? "", text: fd?.body?.innerText ?? "", ready: fd?.readyState ?? "" };
        if (lastState.ready === "complete" && (!expectedPathname || lastState.pathname === expectedPathname) && (!check.needle || lastState.text.includes(check.needle))) {
          finish({ status: "ok", statusLabel: "Operational" });
        }
      } catch (e) { finish({ status: "unavailable", statusLabel: "Unavailable" }); }
    };
    iframe.addEventListener("load", () => { readState(); if (!settled) intervalId = setInterval(readState, intervalMs); });
    timeoutId = setTimeout(() => finish({ status: "degraded", statusLabel: "Degraded" }), timeoutMs);
    document.body.append(iframe);
    iframe.src = check.path;
  });
}

function StatusPage() {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState({ loading: true, checks: [] });

  useEffect(() => {
    let c = false;
    (async () => {
      setState(p => ({ ...p, loading: true }));
      const checks = await Promise.all(PUBLIC_STATUS_CHECKS.map(probePublicHtmlRoute));
      if (!c) setState({ loading: false, checks, at: new Date().toISOString() });
    })();
    return () => { c = true; };
  }, [nonce]);

  const allOk = state.checks.every(c => c.status === "ok");

  return (
    <SimplePage title="Status">
      <div className="flex items-center gap-3 mb-8">
        <span
          className="inline-flex items-center gap-2 px-3 py-1 text-[11px] uppercase tracking-wider font-medium"
          style={{
            borderRadius: "9999px",
            border: state.loading
              ? "1px solid rgba(235, 232, 226, 0.08)"
              : allOk
                ? "1px solid rgba(74, 222, 128, 0.2)"
                : "1px solid rgba(251, 191, 36, 0.2)",
            backgroundColor: state.loading
              ? "transparent"
              : allOk
                ? "rgba(74, 222, 128, 0.1)"
                : "rgba(251, 191, 36, 0.1)",
            color: state.loading
              ? "var(--neutral-500)"
              : allOk
                ? "#4ade80"
                : "#fbbf24"
          }}
        >
          {state.loading ? "Checking..." : allOk ? "All systems operational" : "Degraded"}
        </span>
        <button onClick={() => setNonce(v => v + 1)} className="transition-colors" style={{ color: "var(--neutral-600)" }} onMouseEnter={(e) => e.currentTarget.style.color = "var(--neutral-400)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--neutral-600)"}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        </button>
      </div>
      <div className="space-y-0">
        {state.checks.map((c, i) => (
          <div key={c.id} className="flex items-center justify-between py-3.5" style={i > 0 ? { borderTop: "1px solid rgba(235, 232, 226, 0.05)" } : {}}>
            <span className="text-[13px]" style={{ color: "var(--neutral-200)" }}>{c.label}</span>
            <span className="text-[11px] uppercase tracking-wider font-medium" style={{
              color: c.status === "ok" ? "#4ade80" : c.status === "degraded" ? "#fbbf24" : "#f43f5e"
            }}>
              {c.statusLabel}
            </span>
          </div>
        ))}
      </div>
      {state.at ? <p className="mt-4 text-[11px] tabular-nums" style={{ color: "var(--neutral-700)" }}>Checked {new Date(state.at).toLocaleString()}</p> : null}
    </SimplePage>
  );
}

/* ── SIMPLE INFO PAGE ── */

function SimpleInfoPage({ title, summary }) {
  return (
    <SimplePage title={title}>
      <p className="text-[15px]" style={{ color: "var(--neutral-500)" }}>{summary}</p>
      <div className="mt-8 flex gap-3">
        <a
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold"
          style={{ backgroundColor: "var(--gold)", color: "var(--neutral-950)", borderRadius: "6px" }}
        >
          Go home &rarr;
        </a>
        <a
          href="/support"
          className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-medium"
          style={{ border: "1px solid rgba(235, 232, 226, 0.1)", color: "var(--neutral-400)", borderRadius: "6px" }}
        >
          Get help
        </a>
      </div>
    </SimplePage>
  );
}

/* ── PRICING PAGE ── */

const PRICING_TIERS = [
  {
    name: "Free",
    price: "$0",
    period: "",
    description: "Run unlimited workers locally from the CLI. Your keys, your data, no cloud required.",
    features: [
      "Unlimited local workers",
      "Any AI provider",
      "Full charter and guardrails",
      "CLI and MCP support",
      "Community support"
    ],
    cta: "Get started",
    ctaHref: DOCS_GETTING_STARTED,
    ctaExternal: true,
    highlighted: false
  },
  {
    name: "Pro",
    price: "$29",
    period: "/month",
    description: "Cloud-hosted workers that run 24/7. Approve from Slack. Web dashboard.",
    features: [
      "Everything in Free",
      "Cloud-hosted workers",
      "Web dashboard",
      "Slack approvals",
      "Webhook integrations",
      "Email support"
    ],
    cta: "Start free trial",
    ctaHref: "/signup",
    ctaExternal: false,
    highlighted: true
  },
  {
    name: "Team",
    price: "$99",
    period: "/month",
    description: "Shared workers, team approvals, SSO, and audit exports.",
    features: [
      "Everything in Pro",
      "Shared worker dashboard",
      "Team approval workflows",
      "SSO and admin controls",
      "Audit log export",
      "Priority support"
    ],
    cta: "Contact us",
    ctaHref: "/support",
    ctaExternal: false,
    highlighted: false
  }
];

function PricingPage() {
  return (
    <SiteLayout>
      <section className="mx-auto max-w-6xl px-6" style={{ paddingTop: "7rem", paddingBottom: "3rem" }}>
        <FadeIn>
          <h1 style={{ fontSize: "clamp(2rem, 4vw, 2.75rem)", letterSpacing: "-0.03em", fontWeight: 700, color: "var(--neutral-100)" }}>Pricing</h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed" style={{ color: "var(--neutral-500)" }}>
            Start free on your own machine. Scale to the cloud when you're ready.
          </p>
        </FadeIn>
      </section>

      <section className="mx-auto max-w-6xl px-6" style={{ paddingBottom: "6rem" }}>
        <div className="grid gap-6 md:grid-cols-3">
          {PRICING_TIERS.map((tier, i) => (
            <FadeIn key={tier.name} delay={i * 0.08}>
              <div
                className="flex flex-col h-full"
                style={{
                  border: tier.highlighted
                    ? "1px solid rgba(200, 170, 110, 0.25)"
                    : "1px solid rgba(235, 232, 226, 0.06)",
                  borderRadius: "10px",
                  backgroundColor: tier.highlighted
                    ? "rgba(200, 170, 110, 0.03)"
                    : "rgba(235, 232, 226, 0.02)",
                  padding: "2rem"
                }}
              >
                <div>
                  <p className="text-[13px] font-semibold uppercase tracking-[0.1em]" style={{ color: tier.highlighted ? "var(--gold)" : "var(--neutral-400)" }}>
                    {tier.name}
                  </p>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span style={{ fontSize: "2.25rem", fontWeight: 700, letterSpacing: "-0.03em", color: "var(--neutral-100)" }}>{tier.price}</span>
                    {tier.period ? <span className="text-[14px]" style={{ color: "var(--neutral-600)" }}>{tier.period}</span> : null}
                  </div>
                  <p className="mt-4 text-[14px] leading-relaxed" style={{ color: "var(--neutral-500)" }}>{tier.description}</p>
                </div>

                <div className="mt-8 space-y-3 flex-1">
                  {tier.features.map((f) => (
                    <div key={f} className="flex items-start gap-3">
                      <span className="mt-1.5 block h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: tier.highlighted ? "var(--gold)" : "var(--neutral-600)" }} />
                      <span className="text-[13px]" style={{ color: "var(--neutral-400)" }}>{f}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-8">
                  <a
                    href={tier.ctaHref}
                    className="inline-flex items-center justify-center w-full px-4 py-2.5 text-[13px] font-semibold transition-all duration-150"
                    style={
                      tier.highlighted
                        ? { backgroundColor: "var(--gold)", color: "var(--neutral-950)", borderRadius: "6px" }
                        : { border: "1px solid rgba(235, 232, 226, 0.1)", color: "var(--neutral-400)", borderRadius: "6px" }
                    }
                    onMouseEnter={(e) => {
                      if (tier.highlighted) { e.currentTarget.style.backgroundColor = "var(--gold-hover)"; }
                      else { e.currentTarget.style.borderColor = "rgba(235, 232, 226, 0.18)"; e.currentTarget.style.color = "var(--neutral-200)"; }
                    }}
                    onMouseLeave={(e) => {
                      if (tier.highlighted) { e.currentTarget.style.backgroundColor = "var(--gold)"; }
                      else { e.currentTarget.style.borderColor = "rgba(235, 232, 226, 0.1)"; e.currentTarget.style.color = "var(--neutral-400)"; }
                    }}
                    {...(tier.ctaExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  >
                    {tier.cta}
                  </a>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}

/* ── MAIN EXPORT ── */

export default function LovableSite({ mode = "home" }) {
  if (mode === "pricing") return <PricingPage />;
  if (mode === "status") return <StatusPage />;
  if (mode === "security") return <SecurityPage />;
  if (mode === "privacy") return <PrivacyPage />;
  if (mode === "terms") return <TermsPage />;
  if (mode === "support") return <SupportPage />;

  // Killed pages → redirect to home
  if (mode === "product" || mode === "demo" || mode === "developers" || mode === "integrations") return <HomePage />;

  // Docs → external
  if (typeof mode === "string" && mode.startsWith("docs")) {
    if (typeof window !== "undefined") window.location.replace(DOCS_EXTERNAL);
    return null;
  }

  // Onboarding redirects
  if (mode === "onboarding") {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("experience") === "app") { window.location.replace(MANAGED_ONBOARDING_HREF); return null; }
    }
    return <HomePage />;
  }

  // Error pages
  if (mode === "expired") return <SimpleInfoPage title="This link has expired." summary="The approval window closed. Return home to start a new request." />;
  if (mode === "revoked") return <SimpleInfoPage title="This authority was revoked." summary="The grant is no longer valid. Contact support if this is unexpected." />;
  if (mode === "verification_failed") return <SimpleInfoPage title="Verification failed." summary="The action could not be verified. Check your activity feed or contact support." />;
  if (mode === "unsupported_host") return <SimpleInfoPage title="Host not supported." summary="Nooterra currently supports CLI, MCP, and REST API." />;

  // Trust entries → home
  if (mode === "wallet" || mode === "approvals" || mode === "receipts" || mode === "disputes") return <HomePage />;

  return <HomePage />;
}
