import { buildCatalog, buildPublishedCatalog, selectBuild } from './lib/catalog.mjs?v=20261018-helper76';
import { initialSelection, choose } from './lib/selection.mjs?v=20261109-apple-family';
import { downloadSource, MIRROR_ORIGIN } from './lib/mirror.mjs?v=20260920-compact';

const $ = id => document.getElementById(id);
let state = initialSelection();
let path = [];
let onResult = false;
let builds = buildPublishedCatalog([]);
let loading = true, catalogUnavailable = false, mirrorManifest = null;
const platforms = [['android','Android'], ['apple','Apple'], ['linux','Linux'], ['windows','Windows']];
const appleDevices = [['ios','iPhone и iPad'], ['tvos','Apple TV'], ['macos','Mac']];
const names = Object.fromEntries([...platforms, ...appleDevices]);
const version = {
  android:[['mobile','Android 6+'],['legacy','Android 5.0–5.1','Legacy · бета'],['unsupported','Ниже Android 5']],
  tvos:[['mobile','tvOS 18+'],['unsupported','Ниже tvOS 18']],
  ios:[['mobile','iOS / iPadOS 17+'],['unsupported','Ниже iOS / iPadOS 17']],
  macos:[['modern','macOS 13+'],['legacy','macOS 11–12','Legacy'],['unsupported','Ниже macOS 11']]
};
const architectures = {
  macos:[['arm64','Apple Silicon','Чипы Apple M'],['x86_64','Intel','Процессоры Intel']],
  windows:[['x64','Intel / AMD','64 бита · x64'],['arm64','ARM','64 бита · ARM64'],['x86','Intel / AMD','32 бита · x86']],
  linux:[['x86_64','Intel / AMD','64 бита · x86_64'],['arm64','ARM','64 бита · aarch64']]
};
const formats = { deb:'DEB · Debian и Ubuntu',rpm:'RPM · Fedora и openSUSE','pkg.tar.zst':'Пакет Arch Linux',AppImage:'AppImage','tar.gz':'Архив .tar.gz' };
const instructions = {
  android:'Откройте скачанный APK. Если Android запросит разрешение на установку, разрешите её для приложения, из которого открываете файл.',
  macos:'Откройте DMG и перетащите SubVost VPN в «Программы». Запустите приложение оттуда.',
  tvos:'Установите TestFlight на iPhone или iPad и Apple TV с одним аккаунтом App Store. Примите приглашение на телефоне, затем откройте TestFlight на Apple TV и установите SubVost.',
  ipad:'Установите TestFlight из App Store, затем вернитесь сюда и откройте приглашение.',
  ios:'Установите TestFlight из App Store, затем вернитесь сюда и откройте приглашение.',
  windows:'Запустите скачанный установщик и следуйте подсказкам Windows.',
  linux:'Установите пакет средствами своего дистрибутива. Для AppImage разрешите выполнение файла.'
};

function nextStep(s) {
  if (!s.os) return ['os','На какое устройство?','Можно скачать для себя или для другого устройства.',platforms];
  if (s.os === 'apple') return ['os','Какое устройство Apple?','Выберите устройство, на которое хотите установить SubVost.',appleDevices];
  if (s.variant === 'unsupported') return null;
  if (version[s.os] && !s.variant) {
    const hints = {tvos:'На Apple TV откройте «Настройки» → «Основные» → «Об этом устройстве».',android:'Посмотрите в настройках телефона, в разделе «О телефоне».',macos:'Откройте меню Apple и выберите «Об этом Mac».',ios:'Откройте «Настройки» → «Основные» → «Об этом устройстве».'};
    return ['variant','Какая версия системы?',hints[s.os === 'ipad' ? 'ios' : s.os],version[s.os]];
  }
  if (!s.arch) {
    const hints = {windows:'Windows 10 (1809+) или 11. Откройте «Параметры» → «Система» → «О системе» и посмотрите тип системы.',macos:'В меню Apple → «Об этом Mac» указано название чипа или процессора.',linux:'Команда uname -m в терминале покажет архитектуру.'};
    return ['arch','Какой процессор?',hints[s.os],architectures[s.os]];
  }
  if (s.os === 'linux' && !s.format) {
    const options = [...new Set(builds.filter(b => b.os === s.os && b.arch === s.arch && b.variant === s.variant).map(b => b.format))];
    if (!options.length) return null;
    return ['format','Какой пакет?','Выберите формат для своего дистрибутива.',options.map(f => [f,formats[f] || f])];
  }
  return null;
}

function route(moveFocus = false) {
  const parts = location.hash.slice(1).split('/').filter(Boolean);
  // Keep old iPad links working with the unified iPhone and iPad flow.
  if (parts[0] === 'ipad') parts[0] = 'ios';
  if (parts[0] === 'apple' && parts[1] === 'ipad') parts[1] = 'ios';
  // Preserve existing shared links while adding the Apple family step.
  if (appleDevices.some(([key]) => key === parts[0])) parts.unshift('apple');
  state = initialSelection();
  path = [];
  let step = nextStep(state);
  for (const part of parts) {
    if (!step || !step[3].some(([key]) => key === part)) break;
    const [field] = step;
    const picked = choose(state, field, part);
    if (field === 'arch' && state.os === 'macos') picked.variant = state.variant;
    state = picked;
    path.push(part);
    step = nextStep(state);
  }
  onResult = !step;
  $('step').hidden = onResult;
  $('result').hidden = !onResult;
  $('navigation').hidden = !path.length;
  $('back').href = '#' + path.slice(0,-1).join('/');
  if (step) {
    const [field,question,hint,options] = step;
    $('question').textContent = question;
    $('hint').textContent = hint;
    const rows = options.map(([key,title,subtitle]) => {
      const row = document.createElement('a');
      row.className = 'row';
      row.href = '#' + [...path,key].join('/');
      const caption = document.createElement('span');
      caption.textContent = title;
      if (subtitle) {
        const small = document.createElement('small');
        small.textContent = subtitle;
        caption.append(small);
      }
      if (field === 'os') row.append(['apple','macos','linux','android'].includes(key) ? brandIcon(key === 'macos' ? 'apple' : key) : svgIcon(['ios','ipad'].includes(key) ? 'phone' : key === 'tvos' ? 'tv' : 'windows'));
      row.append(caption);
      return row;
    });
    $('choices').replaceChildren(...rows);
  } else renderResult();
  if (moveFocus) {
    for (const id of ['install','trouble']) $(id).open = false;
    const section = $(onResult ? 'result' : 'step');
    section.classList.remove('enter');
    void section.offsetWidth;
    section.classList.add('enter');
    $(onResult ? 'title' : 'question').focus({preventScroll:true});
    window.scrollTo(0,0);
  }
}

function action(caption,url) {
  $('download').href = url;
  $('download').textContent = caption;
  $('download').hidden = false;
}
function renderResult() {
  const build = selectBuild(builds,state);
  const supportedIOS = ['ios','ipad','tvos'].includes(state.os) && state.variant === 'mobile';
  $('download').hidden = true;
  $('download').removeAttribute('href');
  $('alternative').hidden = true;
  $('alternative').removeAttribute('href');
  $('install').hidden = !(build || supportedIOS);
  $('trouble').hidden = false;
  $('flight').hidden = !supportedIOS;
  $('android-install-conflict').hidden = !(build && state.os === 'android');
  $('instruction').textContent = instructions[state.os];
  $('meta').textContent = '';
  if (['ios','ipad','tvos'].includes(state.os)) {
    if (!supportedIOS) {
      $('title').textContent = state.os === 'tvos' ? 'Требуется tvOS 18+' : state.os === 'ipad' ? 'Требуется iPadOS 17+' : 'Требуется iOS / iPadOS 17+';
      action('Выбрать другое устройство','#');
      return;
    }
    $('title').textContent = state.os === 'tvos' ? 'SubVost для Apple TV' : state.os === 'ipad' ? 'SubVost для iPad' : 'SubVost для iPhone и iPad';
    $('meta').textContent = state.os === 'tvos' ? 'tvOS 18+ · TestFlight. Откройте приглашение на iPhone или iPad.' : 'Для установки понадобится TestFlight.';
    action('Открыть в TestFlight','https://testflight.apple.com/join/XPHxBArP');
    return;
  }
  if (state.variant === 'unsupported') {
    $('title').textContent = state.os === 'android' ? 'Требуется Android 5+' : 'Требуется macOS 11+';
    action('Выбрать другое устройство','#');
    return;
  }
  if (!build) {
    $('title').textContent = loading ? 'Загружаем каталог…' : catalogUnavailable ? 'Каталог временно недоступен' : 'Для этого устройства пока нет сборки';
    if (!loading) action('Открыть список файлов','https://download.subvost.fun/files.html');
    return;
  }
  const system = state.os === 'android' ? (state.variant === 'mobile' ? 'Android 6+' : 'Android 5') : names[state.os];
  $('title').textContent = 'SubVost для ' + system;
  const size = (build.size / 1048576).toLocaleString('ru',{maximumFractionDigits:1});
  const cpu = architectures[state.os]?.find(([id]) => id === state.arch);
  const info = [build.version + (build.prerelease ? ' · бета' : ''),cpu && (state.os === 'macos' ? cpu[1] : state.arch),state.os === 'macos' && (state.variant === 'modern' ? 'macOS 13+' : 'macOS 11–12'),size + ' МБ'];
  $('meta').textContent = info.filter(Boolean).join(' · ');
  if (state.os === 'windows' && build.format === 'zip') $('instruction').textContent = 'Распакуйте ZIP в отдельную папку и запустите SubVost VPN.';
  action('Скачать ' + build.format.toUpperCase(),build.url);
  const mirror = downloadSource(build,mirrorManifest);
  if (mirror.mirrored) {
    $('alternative').textContent = 'Скачать тот же файл с сервера в РФ';
    $('alternative').href = mirror.url;
    $('alternative').hidden = false;
  }
}
function catalogChanged() {
  if (state.os === 'linux') route();
  else if (onResult) renderResult();
}
window.addEventListener('hashchange',() => route(true));
route();
function svgIcon(kind) {
  const paths = {
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v5m6-5v5M9 18v5m6-5v5M1 9h5m-5 6h5m12-6h5m-5 6h5"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
    tv: '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 22h8m-4-4v4"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-3 14h2"/>',
    windows: '<path d="M3 4h8v7H3zm10 0h8v7h-8zM3 13h8v7H3zm10 0h8v7h-8z"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    help: '<path d="m3 10 18-7-6 18-4-7-8-4Zm8 4L21 3"/>',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'icon');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = paths[kind] ?? paths.cpu; // Static local icon paths only, never network content.
  return svg;
}
function brandIcon(name) {
  const img = document.createElement('img'); img.src = `icons/${name}.svg`; img.alt = ''; img.className = 'icon brand-symbol'; return img;
}
// One request per ten minutes per browser; no perpetual polling or tracking.
// A checked-in snapshot keeps the page usable if GitHub API is blocked/rate-limited.
async function fetchJSON(url, timeout, headers = {}) {
  // AbortSignal.timeout is absent from Safari shipped with older supported Macs.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) throw new Error('Catalog unavailable');
    return await response.json();
  } finally { clearTimeout(timer); }
}
async function loadCatalog() {
  let snapshot = [];
  try {
    const data = await fetchJSON('./catalog.json?v=20261013-mac68', 5000);
    builds = buildPublishedCatalog(data.releases);
    snapshot = data.releases;
    catalogChanged();
  } catch { /* The live request can recover. */ }
  // No GitHub API dependency on the Russian page. Both mirrored releases and
  // the bundled public fallback have byte-verified publication records. Mirror
  // download availability is checked independently against its own manifest.
  if (location.origin === MIRROR_ORIGIN && snapshot.length) {
    loading = false;
    catalogChanged();
    return;
  }
  try {
    let cache;
    try { cache = JSON.parse(localStorage.getItem('subvost-public-releases-v3')); } catch { /* storage may be disabled */ }
    let releases;
    if (cache && Date.now() - cache.time >= 0 && Date.now() - cache.time < 600000) releases = cache.releases;
    else {
      releases = await fetchJSON('https://api.github.com/repos/PystoyPlayer/subvost-vpn/releases?per_page=100', 8000, { Accept: 'application/vnd.github+json' });
      const checked = buildCatalog(releases);
      if (!checked.length) throw new Error('No usable release assets');
      try { localStorage.setItem('subvost-public-releases-v3', JSON.stringify({ time: Date.now(), releases })); } catch { /* caching is optional */ }
    }
    // GitHub/CDN and the ten-minute browser cache can predate the published
    // snapshot. Keep the newest validated asset per OS/CPU/package in that case.
    // Release removal must also update the checked-in snapshot.
    builds = buildPublishedCatalog([...snapshot, ...releases]);

  } catch {
    catalogUnavailable = !snapshot.length;
  }
  loading = false;
  catalogChanged();
}
loadCatalog();
fetchJSON(`${MIRROR_ORIGIN}/manifest.json`, 5000)
  .then(manifest => { mirrorManifest = manifest; })
  .catch(() => { /* GitHub remains available; unverified mirror options stay disabled. */ })
  .finally(() => { if (onResult) renderResult(); });
