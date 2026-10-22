// ==UserScript==
// @name         GeoFS Underwater Camera Probe
// @namespace    local.geofs.underwater.camera.probe
// @version      0.1.0
// @description  Diagnostics for GeoFS camera position and Cesium terrain collision while testing underwater camera behavior.
// @match        https://www.geo-fs.com/*
// @match        https://geo-fs.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const GLOBAL_KEY = '__geofsUnderwaterCameraProbe';
  if (window[GLOBAL_KEY]?.cleanup) window[GLOBAL_KEY].cleanup();

  let panel;
  let intervalId = null;
  let originalCollisionState;
  let collisionWasChanged = false;
  let lastViewer = null;

  const fmt = (value, digits = 1) => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(digits) : '—';
  };

  function getApi() {
    const root = window.geofs;
    const api = root?.api;
    const viewer = api?.viewer || root?.viewer || window.viewer || null;
    const camera = viewer?.scene?.camera || api?.camera || null;
    const scene = viewer?.scene || null;
    const aircraft = root?.aircraft?.instance || null;
    const lla = aircraft?.llaLocation;
    const cameraCartographic = camera?.positionCartographic;
    const controller = scene?.screenSpaceCameraController || null;

    return {
      root,
      api,
      viewer,
      camera,
      scene,
      controller,
      aircraft,
      aircraftAltitude: Array.isArray(lla) ? lla[2] : undefined,
      aircraftLat: Array.isArray(lla) ? lla[0] : undefined,
      aircraftLon: Array.isArray(lla) ? lla[1] : undefined,
      cameraHeight: cameraCartographic?.height,
      cameraLat: cameraCartographic?.latitude,
      cameraLon: cameraCartographic?.longitude,
      cameraMode: root?.camera?.currentModeName || root?.camera?.currentDefinition?.name || '—'
    };
  }

  function addPanel() {
    if (panel?.isConnected) return;

    panel = document.createElement('section');
    panel.id = 'geofs-underwater-camera-probe';
    panel.style.cssText = [
      'position:fixed', 'right:12px', 'bottom:12px', 'z-index:2147483647',
      'width:310px', 'max-width:calc(100vw - 24px)', 'box-sizing:border-box',
      'padding:12px', 'background:rgba(14,20,29,.94)', 'color:#f2f5f8',
      'border:1px solid rgba(255,255,255,.22)', 'border-radius:10px',
      'box-shadow:0 5px 24px rgba(0,0,0,.35)',
      'font:12px/1.45 system-ui,-apple-system,Segoe UI,sans-serif'
    ].join(';');

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
        <strong style="font-size:13px">GeoFS Underwater Probe</strong>
        <button data-action="hide" title="Hide panel" style="padding:2px 7px">Hide</button>
      </div>
      <div data-role="status" style="color:#f6cc72;margin-bottom:7px">GeoFS APIを待機中…</div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:3px 10px;margin-bottom:10px">
        <span>Cesium Viewer</span><strong data-role="viewer">—</strong>
        <span>機体高度 / ellipsoid</span><strong data-role="aircraftHeight">—</strong>
        <span>カメラ高度 / ellipsoid</span><strong data-role="cameraHeight">—</strong>
        <span>カメラ位置 (lat, lon)</span><strong data-role="cameraPosition">—</strong>
        <span>GeoFSカメラモード</span><strong data-role="cameraMode">—</strong>
        <span>地形衝突判定</span><strong data-role="collision">—</strong>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button data-action="toggle" style="flex:1;padding:6px 8px">衝突判定を切替</button>
        <button data-action="restore" style="padding:6px 8px" disabled>元に戻す</button>
        <button data-action="report" style="padding:6px 8px">Consoleに記録</button>
      </div>
      <div style="margin-top:8px;color:#bac5d2;font-size:11px">※ このテストはカメラを強制移動しません。水中へ追従しない原因を切り分けます。</div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('[data-action="hide"]').addEventListener('click', () => {
      panel.style.display = 'none';
      const reopen = document.createElement('button');
      reopen.id = 'geofs-underwater-probe-reopen';
      reopen.textContent = 'Underwater Probe';
      reopen.style.cssText = 'position:fixed;right:1px;bottom:12px;z-index:2147483647;padding:8px 10px;background:#0e141d;color:#fff;border:1px solid #8793a5;border-radius:8px;';
      reopen.addEventListener('click', () => { panel.style.display = 'block'; reopen.remove(); });
      document.body.appendChild(reopen);
    });

    panel.querySelector('[data-action="toggle"]').addEventListener('click', () => {
      const data = getApi();
      const controller = data.controller;
      if (!controller || typeof controller.enableCollisionDetection !== 'boolean') {
        setStatus('Cesiumの衝突判定コントローラーを取得できません。', '#ff9e9e');
        return;
      }
      if (!collisionWasChanged) {
        originalCollisionState = controller.enableCollisionDetection;
        collisionWasChanged = true;
        panel.querySelector('[data-action="restore"]').disabled = false;
      }
      controller.enableCollisionDetection = !controller.enableCollisionDetection;
      updatePanel();
    });

    panel.querySelector('[data-action="restore"]').addEventListener('click', () => {
      const data = getApi();
      if (data.controller && collisionWasChanged && typeof originalCollisionState === 'boolean') {
        data.controller.enableCollisionDetection = originalCollisionState;
      }
      collisionWasChanged = false;
      originalCollisionState = undefined;
      panel.querySelector('[data-action="restore"]').disabled = true;
      updatePanel();
    });

    panel.querySelector('[data-action="report"]').addEventListener('click', () => {
      const data = getApi();
      const report = {
        geoFSAvailable: !!data.root,
        viewerAvailable: !!data.viewer,
        sceneAvailable: !!data.scene,
        cesiumCameraAvailable: !!data.camera,
        cameraHeightEllipsoidM: Number.isFinite(Number(data.cameraHeight)) ? Number(data.cameraHeight) : null,
        aircraftHeightEllipsoidM: Number.isFinite(Number(data.aircraftAltitude)) ? Number(data.aircraftAltitude) : null,
        aircraftLLA: data.aircraft ? data.aircraft.llaLocation : null,
        cameraMode: data.cameraMode,
        collisionDetection: typeof data.controller?.enableCollisionDetection === 'boolean'
          ? data.controller.enableCollisionDetection : null,
        page: location.href,
        timestamp: new Date().toISOString()
      };
      console.group('GeoFS Underwater Camera Probe');
      console.table(report);
      console.log('Raw GeoFS API object:', data.root);
      console.log('Camera:', data.camera);
      console.log('Viewer:', data.viewer);
      console.groupEnd();
      setStatus('Consoleに診断情報を出力しました。', '#a8e6b0');
    });
  }

  function setStatus(text, color) {
    if (!panel) return;
    const el = panel.querySelector('[data-role="status"]');
    el.textContent = text;
    if (color) el.style.color = color;
  }

  function setValue(role, value) {
    const el = panel?.querySelector(`[data-role="${role}"]`);
    if (el) el.textContent = value;
  }

  function updatePanel() {
    if (!panel?.isConnected) return;
    const data = getApi();
    const hasViewer = !!data.viewer;
    if (data.viewer) lastViewer = data.viewer;

    setValue('viewer', hasViewer ? '検出' : '未検出');
    setValue('aircraftHeight', Number.isFinite(Number(data.aircraftAltitude)) ? `${fmt(data.aircraftAltitude)} m` : '取得不可');
    setValue('cameraHeight', Number.isFinite(Number(data.cameraHeight)) ? `${fmt(data.cameraHeight)} m` : '取得不可');
    const cLat = Number(data.cameraLat) * 180 / Math.PI;
    const cLon = Number(data.cameraLon) * 180 / Math.PI;
    setValue('cameraPosition', Number.isFinite(cLat) && Number.isFinite(cLon) ? `${fmt(cLat, 4)}, ${fmt(cLon, 4)}` : '取得不可');
    setValue('cameraMode', String(data.cameraMode || '—'));
    setValue('collision', typeof data.controller?.enableCollisionDetection === 'boolean'
      ? (data.controller.enableCollisionDetection ? 'ON' : 'OFF')
      : '取得不可');

    if (!data.root) {
      setStatus('GeoFS APIを待機中…', '#f6cc72');
    } else if (!data.viewer || !data.camera) {
      setStatus('GeoFSは検出しましたが、Cesium Viewer/Cameraが見つかりません。Consoleに記録してください。', '#ffcc80');
    } else {
      setStatus('接続済み。海上でカメラ高度を確認してください。', '#a8e6b0');
    }
  }

  function cleanup() {
    if (intervalId !== null) clearInterval(intervalId);
    if (panel?.isConnected) panel.remove();
    const reopen = document.getElementById('geofs-underwater-probe-reopen');
    if (reopen) reopen.remove();
  }

  window[GLOBAL_KEY] = { cleanup, getSnapshot: getApi };

  addPanel();
  updatePanel();
  intervalId = window.setInterval(updatePanel, 500);
})();
