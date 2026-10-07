// ===========================================================================
// 视频背景 · Folia 模组 · client 入口
// Copyright (C) 2026 NaLuna
//
// 本程序是自由软件：你可以依据 GNU Affero 通用公共许可证（AGPL-3.0，由自由
// 软件基金会发布）第 3 版或任何更新版本的条件，重新分发和/或修改它。
// 本程序按「现状」提供，不附带任何担保。许可证全文见同目录的 LICENSE 文件。
// ===========================================================================

// 视频背景 · Folia / Folium 1.x 模组
//
// 用本地视频当播放页的背景，循环播放。纯 client 入口，不需要 main。
// 选中的文件来自 folium.ui.pickFile({ accept: 'video', persist: true })，
// 拿到的 folia-mod://_files/... URL 支持 Range，可直接做 <video> 的 src；
// 授权 id 存进 folium.storage，重启后用 folium.ui.restoreFile 找回。
//
// 契约依据：docs/folium/api.md（Folium 1.4）

const STORAGE_KEY = 'video-grant-id';

/* ------------------------------------------------------------------ 文案 */

// FoliumLabel = Record<locale, string>，宿主自己解析 def.label / param.label；
// 只有自绘的设置面板需要我们自己挑本地化文本。
function L(label, locale) {
  if (!label) return '';
  if (typeof label === 'string') return label;
  return label[locale] || label.en || label['zh-CN'] || Object.values(label).find(Boolean) || '';
}

function guessLocale() {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return String(lang).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

const T = {
  background: { 'zh-CN': '视频背景', en: 'Video background' },
  pick: { 'zh-CN': '选择视频…', en: 'Choose video…' },
  clear: { 'zh-CN': '清除', en: 'Clear' },
  none: { 'zh-CN': '还没有选择视频', en: 'No video chosen yet' },
  current: { 'zh-CN': '当前：', en: 'Current: ' },
  hint: { 'zh-CN': '在背景设置里选择一个本地视频', en: 'Pick a local video in the background settings' },
  cmdPick: { 'zh-CN': '选择视频背景', en: 'Choose video background' },
  cmdPickDesc: { 'zh-CN': '挑一个本地视频当背景', en: 'Pick a local video to use as the background' },
  cmdClear: { 'zh-CN': '清除视频背景', en: 'Clear video background' },
  cmdClearDesc: {
    'zh-CN': '移除当前视频，回到主题背景',
    en: 'Remove the current video and fall back to the theme background',
  },
  picked: { 'zh-CN': '已选择：', en: 'Chosen: ' },
  notPicked: { 'zh-CN': '没有选择视频', en: 'No video chosen' },
  cleared: { 'zh-CN': '已清除视频背景', en: 'Video background cleared' },
};

/* ------------------------------------------------------------ 设置 schema */

const SETTINGS = [
  {
    key: 'fit',
    type: 'select',
    defaultValue: 'cover',
    label: { 'zh-CN': '填充方式', en: 'Fit' },
    description: {
      'zh-CN': '视频在背景层里怎么缩放。',
      en: 'How the video scales inside the background layer.',
    },
    options: [
      { value: 'cover', label: { 'zh-CN': '裁剪铺满', en: 'Cover' } },
      { value: 'contain', label: { 'zh-CN': '完整显示', en: 'Contain' } },
      { value: 'fill', label: { 'zh-CN': '拉伸铺满', en: 'Fill' } },
    ],
  },
  {
    key: 'dim',
    type: 'number',
    defaultValue: 0.35,
    min: 0,
    max: 0.95,
    step: 0.05,
    label: { 'zh-CN': '压暗', en: 'Dim' },
    description: {
      'zh-CN': '在视频上叠一层黑色，让歌词更好读。',
      en: 'Black overlay over the video so the lyrics stay readable.',
    },
  },
  {
    key: 'blur',
    type: 'number',
    defaultValue: 0,
    min: 0,
    max: 30,
    step: 1,
    label: { 'zh-CN': '模糊', en: 'Blur' },
    description: {
      'zh-CN': '让背景失焦，前景更突出。',
      en: 'Defocuses the background so the foreground stands out.',
    },
  },
  {
    key: 'speed',
    type: 'number',
    defaultValue: 1,
    min: 0.25,
    max: 2,
    step: 0.05,
    label: { 'zh-CN': '播放速度', en: 'Speed' },
  },
  {
    key: 'volume',
    type: 'number',
    defaultValue: 0,
    min: 0,
    max: 1,
    step: 0.05,
    label: { 'zh-CN': '音量', en: 'Volume' },
    description: {
      'zh-CN': '0 为静音（默认，避免和音乐打架）。',
      en: '0 mutes (the default, so it never fights the music).',
    },
  },
  {
    key: 'pauseWithMusic',
    type: 'boolean',
    defaultValue: true,
    label: { 'zh-CN': '随音乐暂停', en: 'Pause with music' },
  },
  {
    key: 'loop',
    type: 'boolean',
    defaultValue: true,
    label: { 'zh-CN': '循环播放', en: 'Loop' },
  },
];

/* ---------------------------------------------------------------- 控件 */

const ACCENT = 'var(--folium-accent, #7c6cff)';

function styleButton(btn, primary) {
  btn.type = 'button';
  btn.style.cssText = [
    'appearance:none',
    'border:1px solid rgba(128,128,128,.35)',
    'border-radius:8px',
    'padding:6px 12px',
    'font:inherit',
    'font-size:13px',
    'line-height:1.4',
    'cursor:pointer',
    primary ? `background:${ACCENT}` : 'background:transparent',
    primary ? 'color:#fff' : 'color:inherit',
  ].join(';');
}

// 按 FoliumParam 的声明生成一个字段。返回 { el, refresh }。
function buildField(param, locale, params) {
  const el = document.createElement('label');
  el.style.cssText = 'display:flex;flex-direction:column;gap:6px;font-size:13px;line-height:1.4;';

  const head = document.createElement('span');
  head.textContent = L(param.label, locale);
  head.style.cssText = 'opacity:.9;';
  el.append(head);

  let control;
  let readout = null;

  if (param.type === 'boolean') {
    control = document.createElement('input');
    control.type = 'checkbox';
    control.style.cssText = `width:16px;height:16px;accent-color:${ACCENT};`;
    el.append(control);
  } else if (param.type === 'select') {
    control = document.createElement('select');
    control.style.cssText = [
      'appearance:none',
      'border:1px solid rgba(128,128,128,.35)',
      'border-radius:8px',
      'padding:6px 10px',
      'font:inherit',
      'font-size:13px',
      'background:transparent',
      'color:inherit',
    ].join(';');
    for (const opt of param.options || []) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = L(opt.label, locale);
      option.style.color = '#111';
      control.append(option);
    }
    el.append(control);
  } else if (param.type === 'number') {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;';
    control = document.createElement('input');
    control.type = 'range';
    if (typeof param.min === 'number') control.min = String(param.min);
    if (typeof param.max === 'number') control.max = String(param.max);
    if (typeof param.step === 'number') control.step = String(param.step);
    control.style.cssText = `flex:1;min-width:0;accent-color:${ACCENT};`;
    readout = document.createElement('span');
    readout.style.cssText =
      'min-width:3.5em;text-align:right;opacity:.65;font-variant-numeric:tabular-nums;';
    row.append(control, readout);
    el.append(row);
  } else {
    control = document.createElement('input');
    control.type = 'text';
    control.placeholder = param.placeholder || '';
    control.style.cssText = [
      'border:1px solid rgba(128,128,128,.35)',
      'border-radius:8px',
      'padding:6px 10px',
      'font:inherit',
      'font-size:13px',
      'background:transparent',
      'color:inherit',
    ].join(';');
    el.append(control);
  }

  if (param.description) {
    const desc = document.createElement('span');
    desc.textContent = L(param.description, locale);
    desc.style.cssText = 'font-size:12px;opacity:.5;line-height:1.45;';
    el.append(desc);
  }

  const commit = () => {
    let value;
    if (param.type === 'boolean') value = control.checked;
    else if (param.type === 'number') value = Number(control.value);
    else value = control.value;
    params.set({ [param.key]: value });
  };

  if (param.type === 'number') {
    control.addEventListener('input', () => {
      if (readout) readout.textContent = control.value;
      commit();
    });
  } else {
    control.addEventListener('change', commit);
  }

  const refresh = () => {
    const current = (params.get() || {})[param.key];
    const value = current === undefined || current === null ? param.defaultValue : current;
    if (param.type === 'boolean') {
      control.checked = value !== false;
    } else {
      control.value = value === undefined || value === null ? '' : String(value);
      if (readout) readout.textContent = control.value;
    }
  };

  return { el, refresh };
}

/* -------------------------------------------------------------- 背景绘制 */

function mountBackground(store, container, ctx) {
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';

  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'auto';
  video.muted = true;
  video.setAttribute('aria-hidden', 'true');
  video.disablePictureInPicture = true;
  video.style.cssText = [
    'position:absolute',
    'inset:0',
    'width:100%',
    'height:100%',
    'object-fit:cover',
    'pointer-events:none',
    'background:transparent',
    'transform-origin:center',
  ].join(';');

  const shade = document.createElement('div');
  shade.style.cssText =
    'position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;';

  const hint = document.createElement('div');
  hint.textContent = L(T.hint, guessLocale());
  hint.style.cssText = [
    'position:absolute',
    'inset:0',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-size:14px',
    'padding:0 24px',
    'text-align:center',
    'opacity:.4',
    'color:var(--folium-primary, #fff)',
    'pointer-events:none',
  ].join(';');

  wrap.append(video, shade, hint);
  container.append(wrap);

  let lastUrl = null;
  let frameSeeked = false;

  const settings = () => ctx.getSettings() || {};

  function syncPlayback() {
    const s = settings();
    if (ctx.staticMode) {
      // 静态预览：只留一帧，不动。
      if (!video.paused) video.pause();
      return;
    }
    const shouldPause = s.pauseWithMusic !== false && ctx.isPaused();
    if (shouldPause) {
      if (!video.paused) video.pause();
    } else {
      const playing = video.play();
      if (playing && typeof playing.catch === 'function') playing.catch(() => {});
    }
  }

  function apply() {
    const s = settings();
    const theme = ctx.getTheme() || {};

    video.style.objectFit =
      s.fit === 'contain' ? 'contain' : s.fit === 'fill' ? 'fill' : 'cover';

    const blur = Number(s.blur) || 0;
    video.style.filter = blur > 0 ? `blur(${blur}px)` : '';
    // 模糊会把边缘晕开，稍微放大一点盖住。
    video.style.transform = blur > 0 ? 'scale(1.06)' : '';

    shade.style.opacity = String(Math.min(0.95, Math.max(0, Number(s.dim) || 0)));

    const volume = Math.min(1, Math.max(0, Number(s.volume) || 0));
    try {
      video.volume = volume;
    } catch {
      /* 忽略 */
    }
    video.muted = volume <= 0;

    const speed = Math.min(2, Math.max(0.25, Number(s.speed) || 1));
    try {
      video.playbackRate = speed;
    } catch {
      /* 忽略 */
    }

    video.loop = s.loop !== false;

    const url = store.state.url;
    if (url !== lastUrl) {
      lastUrl = url;
      frameSeeked = false;
      if (url) video.src = url;
      else video.removeAttribute('src');
      try {
        video.load();
      } catch {
        /* 忽略 */
      }
    }

    if (url) {
      wrap.style.background = 'transparent';
      hint.style.display = 'none';
    } else {
      wrap.style.background = theme.backgroundColor || '#000';
      hint.style.display = '';
    }

    syncPlayback();
  }

  function onLoaded() {
    const s = settings();
    const wantsStill = ctx.staticMode || (s.pauseWithMusic !== false && ctx.isPaused());
    if (wantsStill && !frameSeeked) {
      frameSeeked = true;
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      // 第一帧常常是黑的，往里挪一点。
      try {
        video.currentTime = duration > 0 ? Math.min(1, duration * 0.25) : 0;
      } catch {
        /* 忽略 */
      }
    }
    syncPlayback();
  }

  video.addEventListener('loadedmetadata', onLoaded);
  video.addEventListener('loadeddata', onLoaded);

  const offContext = ctx.subscribe(apply);
  const offStore = store.subscribe(apply);

  apply();

  return () => {
    try {
      if (typeof offContext === 'function') offContext();
    } catch {
      /* 忽略 */
    }
    try {
      if (typeof offStore === 'function') offStore();
    } catch {
      /* 忽略 */
    }
    video.removeEventListener('loadedmetadata', onLoaded);
    video.removeEventListener('loadeddata', onLoaded);
    try {
      video.pause();
    } catch {
      /* 忽略 */
    }
    try {
      video.removeAttribute('src');
      video.load();
    } catch {
      /* 忽略 */
    }
    wrap.remove();
  };
}

/* ---------------------------------------------------- 背景自己的设置面板 */

function mountSettings(store, container, ctx) {
  const locale = ctx.locale || guessLocale();

  const root = document.createElement('div');
  root.style.cssText =
    'display:flex;flex-direction:column;gap:16px;font:inherit;color:var(--folium-primary, inherit);';
  container.append(root);

  const fileBox = document.createElement('div');
  fileBox.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

  const nameRow = document.createElement('div');
  nameRow.style.cssText = 'font-size:13px;line-height:1.5;opacity:.8;word-break:break-all;';

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';

  const pickBtn = document.createElement('button');
  pickBtn.textContent = L(T.pick, locale);
  styleButton(pickBtn, true);

  const clearBtn = document.createElement('button');
  clearBtn.textContent = L(T.clear, locale);
  styleButton(clearBtn, false);

  actions.append(pickBtn, clearBtn);
  fileBox.append(nameRow, actions);
  root.append(fileBox);

  const fields = [];
  for (const param of ctx.params.schema || []) {
    const field = buildField(param, locale, ctx.params);
    fields.push(field);
    root.append(field.el);
  }

  function refreshFile() {
    nameRow.textContent = store.state.name
      ? L(T.current, locale) + store.state.name
      : L(T.none, locale);
    const empty = !store.state.url;
    clearBtn.disabled = empty;
    clearBtn.style.opacity = empty ? '.45' : '1';
    clearBtn.style.cursor = empty ? 'default' : 'pointer';
  }

  function refreshFields() {
    for (const field of fields) field.refresh();
  }

  pickBtn.addEventListener('click', async () => {
    pickBtn.disabled = true;
    try {
      await store.pickVideo();
    } finally {
      pickBtn.disabled = false;
      refreshFile();
    }
  });

  clearBtn.addEventListener('click', async () => {
    if (!store.state.url) return;
    clearBtn.disabled = true;
    try {
      await store.clearVideo();
    } finally {
      refreshFile();
    }
  });

  const offParams = ctx.params.subscribe(refreshFields);
  const offStore = store.subscribe(refreshFile);

  refreshFile();
  refreshFields();

  return () => {
    try {
      if (typeof offParams === 'function') offParams();
    } catch {
      /* 忽略 */
    }
    try {
      if (typeof offStore === 'function') offStore();
    } catch {
      /* 忽略 */
    }
    root.remove();
  };
}

/* ---------------------------------------------------------------- 入口 */

export default function activate(folium) {
  const listeners = new Set();
  const state = { url: null, name: null, grantId: null };
  let restored = false;

  function emit() {
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch (err) {
        folium.log.error('视频背景：监听器出错', String(err));
      }
    }
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // 跨重启恢复上次选的文件。恢复失败就清掉记录，不打扰用户。
  async function restoreVideo() {
    if (restored) return;
    restored = true;
    try {
      const grantId = await folium.storage.get(STORAGE_KEY);
      if (typeof grantId !== 'string' || !grantId) return;
      if (typeof folium.ui.restoreFile !== 'function') return;
      const handle = await folium.ui.restoreFile(grantId);
      if (handle && handle.url) {
        state.url = handle.url;
        state.name = handle.name || null;
        state.grantId = grantId;
        emit();
      } else {
        await folium.storage.delete(STORAGE_KEY);
      }
    } catch (err) {
      folium.log.warn('视频背景：恢复上次选择失败', String(err));
    }
  }

  async function pickVideo() {
    try {
      const handle = await folium.ui.pickFile({ accept: 'video', persist: true });
      if (!handle || !handle.url) return false;
      const previous = state.grantId;
      state.url = handle.url;
      state.name = handle.name || null;
      state.grantId = typeof handle.grantId === 'string' ? handle.grantId : null;
      if (state.grantId) {
        try {
          await folium.storage.set(STORAGE_KEY, state.grantId);
        } catch (err) {
          folium.log.warn('视频背景：保存授权失败，重启后需要重新选择', String(err));
        }
      }
      if (previous && previous !== state.grantId && typeof folium.ui.releaseFile === 'function') {
        try {
          await folium.ui.releaseFile(previous);
        } catch {
          /* 忽略 */
        }
      }
      emit();
      return true;
    } catch (err) {
      folium.log.error('视频背景：选择视频失败', String(err));
      return false;
    }
  }

  async function clearVideo() {
    const previous = state.grantId;
    state.url = null;
    state.name = null;
    state.grantId = null;
    try {
      await folium.storage.delete(STORAGE_KEY);
    } catch {
      /* 忽略 */
    }
    if (previous && typeof folium.ui.releaseFile === 'function') {
      try {
        await folium.ui.releaseFile(previous);
      } catch {
        /* 忽略 */
      }
    }
    emit();
  }

  const store = { state, subscribe, pickVideo, clearVideo };
  const locale = guessLocale();

  folium.registries.backgrounds.register({
    id: 'video',
    label: T.background,
    mount: (container, ctx) => mountBackground(store, container, ctx),
    settings: SETTINGS,
    settingsPanel: (container, ctx) => mountSettings(store, container, ctx),
  });

  // 命令面板 / 模组面板里也能直接选，省得去找背景设置。
  folium.registries.commands.register({
    id: 'pick',
    label: T.cmdPick,
    description: T.cmdPickDesc,
    keywords: ['video', 'background', 'wallpaper', '视频', '背景', '壁纸'],
    run: async () => {
      const ok = await pickVideo();
      return { message: ok ? L(T.picked, locale) + (state.name || '') : L(T.notPicked, locale) };
    },
  });

  folium.registries.commands.register({
    id: 'clear',
    label: T.cmdClear,
    description: T.cmdClearDesc,
    keywords: ['video', 'background', 'clear', '视频', '背景', '清除'],
    run: async () => {
      await clearVideo();
      return { message: L(T.cleared, locale) };
    },
  });

  void restoreVideo();

  // 注册项由宿主自动撤下，这里只收自己的监听器。
  return () => {
    listeners.clear();
  };
}
