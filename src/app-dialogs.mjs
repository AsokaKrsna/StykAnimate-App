/**
 * The app's own prompts (architecture.md §3.8): Save your changes? before a
 * document is replaced, the project's name, Recent files, Performance, the
 * import notes, the Stick Nodes pack picker and Discard frame changes?. Each
 * uses the shared #dialog (showDialog) or the kit's prompt, as before; M6
 * moves them onto the dialog kit's confirm, prompt and choose.
 *
 * The `rename`, `open-recent` and `performance` commands register
 * themselves in the app's `actions` map, before app.mjs wraps every action.
 *
 * DOM-free at import. ctx (from app.mjs): {editor, state, $, esc, actions,
 * desktop, overlays, playbackMetrics, guarded, pause, finishCurrentEdit,
 * showDialog, closeDialog, promptText, saveNative, acceptNativeFile,
 * updateTitle, localization()}.
 */
import { icon } from "./icons.mjs";

export function createAppDialogs(ctx) {
  const {
    editor, state, $, esc, actions, desktop, overlays, playbackMetrics, guarded, pause, finishCurrentEdit,
    showDialog, closeDialog, promptText, saveNative, acceptNativeFile, updateTitle,
  } = ctx;
  async function confirmReplace() {
    finishCurrentEdit();
    if (!editor.dirty) return true;
    return new Promise((resolve) => {
      showDialog(
        "Save your changes?",
        `<p>Your current project has unsaved changes. Save a StykAnimate project to keep editing it later.</p><div class="dialog-actions"><button class="button" id="keep-editing">Cancel</button><button class="button" id="discard-changes">Discard</button><button class="button primary" id="save-changes">Save project</button></div>`,
      );
      // Escape, the close button and Cancel all close the shared dialog; each
      // settles as "keep editing". The listener is removed once a choice lands.
      const dialog = $("dialog"),
        settle = (replace) => {
          dialog.removeEventListener("close", keep);
          resolve(replace);
        },
        keep = () => settle(false);
      dialog.addEventListener("close", keep);
      $("keep-editing").onclick = closeDialog;
      $("discard-changes").onclick = () => {
        settle(true);
        closeDialog();
      };
      $("save-changes").onclick = guarded(async () => {
        const saved = await saveNative();
        if (saved) {
          settle(true);
          closeDialog();
        }
      });
    });
  }
  /** The source features a Pivot or Stick Nodes import may show differently. */
  function showImportNotes(warnings, { pivot = false } = {}) {
    showDialog(pivot ? 'Pivot import notes' : 'Stick Nodes import notes',`<p>The asset is ready to edit. These source features may look or behave differently:</p><ul>${warnings.map(w=>`<li>${esc(w.message)}</li>`).join('')}</ul>`);
  }
  /** Which asset of a Stick Nodes pack to import: its index, or null when the dialog closes. */
  function chooseSticknodesEntry(entries) {
    return new Promise(resolve=>{
      showDialog('Choose a Stick Nodes asset',`<p>This pack contains ${entries.length} assets.</p><select id="sticknodes-archive-entry" style="width:100%" size="12">${entries.map(e=>`<option value="${e.index}">${esc(e.name)}</option>`).join('')}</select><div class="dialog-actions"><button id="sticknodes-archive-open" class="primary">Import selected asset</button></div>`);
      const dialog=$('dialog'),select=$('sticknodes-archive-entry');select.selectedIndex=0;
      const cancel=()=>{dialog.removeEventListener('close',cancel);resolve(null);};
      dialog.addEventListener('close',cancel,{once:true});
      $('sticknodes-archive-open').onclick=()=>{const index=Number(select.value);dialog.removeEventListener('close',cancel);dialog.close();resolve(index);};
    });
  }
  /** Asks before Simple mode restores a frame's saved pose. */
  function confirmDiscardFrame() {
    return new Promise((resolve) => {
      showDialog(
        "Discard frame changes?",
        '<p>Restore the frame to its saved pose? You can undo this change.</p><div class="dialog-actions"><button class="button" id="keep-frame-draft">Keep changes</button><button class="button primary" id="discard-frame-draft">Discard</button></div>',
      );
      const cancel = () => resolve(false);
      $("dialog").addEventListener("close", cancel, { once: true });
      $("keep-frame-draft").onclick = () => closeDialog();
      $("discard-frame-draft").onclick = () => {
        resolve(true);
        closeDialog();
      };
    });
  }
  function showPerformance() {
    const presentation = playbackMetrics.snapshot(performance.now());
    const sorted = [...state.renderSamples].sort((a, b) => a - b),
      p = (n) =>
        sorted[
          Math.min(sorted.length - 1, Math.floor(sorted.length * n))
        ]?.toFixed(2) || "—";
    showDialog(
      "Performance",
      `<table class="metric-table">${[
        ["Renderer", state.renderer?.stats?.backend || "Initializing"],
        ["Playback FPS / target", presentation.fps === null ? "—"
          : `${presentation.fps.toFixed(1)} / ${presentation.targetFps.toFixed(1)}`],
        ["Playback startup", presentation.startupMs === null ? "—" : `${presentation.startupMs.toFixed(1)} ms`],
        ["Playback buffering", `${presentation.bufferingMs.toFixed(1)} ms · ${presentation.bufferingEvents} waits`],
        ["Recent CPU frame p50", `${p(0.5)} ms`],
        ["Recent CPU frame p95", `${p(0.95)} ms`],
        ["Recent CPU frame p99", `${p(0.99)} ms`],
        ["Measured frames", sorted.length],
        ["Current scene figures", editor.frame.objects.length.toLocaleString()],
        [
          "Current scene segments",
          editor.frame.objects
            .reduce(
              (n, o) =>
                n +
                (editor.report.figure_types.find(
                  (f) => f.figure_type_id === o.figure_type_id,
                )?.segments.length || 0),
              0,
            )
            .toLocaleString(),
        ],
        [
          "Import decode",
          state.lastImport?.decode_ms !== undefined
            ? `${state.lastImport.decode_ms.toFixed(1)} ms`
            : "—",
        ],
      ]
        .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
        .join(
          "",
        )}</table><p>CPU submission timings include geometry evaluation and selection overlays. They do not measure GPU completion or input-to-display latency. Performance varies with hardware, scene complexity, effects, and media.</p>`,
    );
  }
  Object.assign(actions, {
    rename: async () => {
      const name = await promptText({
        title: "Name your project",
        value: editor.name,
        confirmLabel: "Save name",
        maxLength: 120,
        inputId: "rename-input",
        overlays,
        icon: (glyph) => icon(glyph),
        t: (key, params) => ctx.localization()?.t(key, params),
      });
      if (name === null) return;
      editor.name = name.trim() || "Untitled";
      editor.dirty = true;
      updateTitle();
    },
    "open-recent": async () => {
      pause();
      const entries = await desktop.listRecentFiles();
      showDialog(
        "Recent files",
        `<div class="recent-files">${entries.length ? entries.map((entry) => `<button type="button" class="recent-file" data-recent-id="${esc(entry.id)}" ${entry.missing ? "disabled" : ""}><strong>${esc(entry.name)}</strong><small>${esc(entry.directory)}${entry.missing ? " · Unavailable" : ""}</small></button>`).join("") : "<p>No recent files.</p>"}</div>${entries.length ? '<div class="dialog-actions"><button class="button" id="clear-recent">Clear history</button></div>' : ""}`,
      );
      $("dialog-content")
        .querySelectorAll("[data-recent-id]")
        .forEach(
          (button) =>
            (button.onclick = guarded(async () => {
              const result = await desktop.openRecentFile(
                button.dataset.recentId,
              );
              closeDialog();
              await acceptNativeFile(result);
            })),
        );
      if ($("clear-recent"))
        $("clear-recent").onclick = guarded(async () => {
          await desktop.clearRecentFiles();
          await actions["open-recent"]();
        });
    },
    performance: showPerformance,
  });
  return { confirmReplace, showImportNotes, chooseSticknodesEntry, confirmDiscardFrame, showPerformance };
}
