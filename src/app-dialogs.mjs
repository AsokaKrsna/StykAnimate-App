/**
 * The app's own prompts (architecture.md §3.8): Save changes? before a
 * document is replaced, the project's name, Recent files, Performance, the
 * import notes, the Stick Nodes pack picker and Discard frame changes?. Each
 * is its own dialog from the kit (src/ui/ui-dialog.mjs): a form, so Enter
 * runs the primary action and Escape or × cancels; focus starts on the
 * primary (or the first choice) and returns to where it was; a prompt can
 * open over another dialog without replacing it. The test hooks are today's
 * ids (#keep-editing, #discard-changes, #save-changes, #keep-frame-draft,
 * #discard-frame-draft, #rename-input, #clear-recent, [data-recent-id],
 * .recent-files).
 *
 * The `rename`, `open-recent` and `performance` commands register
 * themselves in the app's `actions` map, before app.mjs wraps every action.
 *
 * DOM-free at import. ctx (from app.mjs): {editor, state, actions, desktop,
 * overlays, playbackMetrics, guarded, pause, finishCurrentEdit, promptText,
 * saveNative, acceptNativeFile, updateTitle, localization()}.
 */
import { icon } from "./icons.mjs";
import { createDialog } from "./ui/ui-dialog.mjs";
import { installRovingFocus } from "./ui/roving-focus.mjs";
import { kitText } from "./ui/ui-strings.mjs";

export function createAppDialogs(ctx) {
  const {
    editor, state, actions, desktop, overlays, playbackMetrics, guarded, pause, finishCurrentEdit,
    promptText, saveNative, acceptNativeFile, updateTitle,
  } = ctx;
  const t = (key, params) => ctx.localization()?.t(key, params);
  const glyph = (name) => icon(name);
  /** A kit dialog with the app's overlay stack, glyphs and words. */
  const dialogOf = (options) => createDialog({ overlays, icon: glyph, t, ...options });
  const paragraph = (text, className = "ui-dialog-desc") => {
    const node = document.createElement("p");
    node.className = className;
    node.textContent = text;
    return node;
  };
  /**
   * Choices as one tab stop: the arrow keys move between them, Enter or Space
   * picks one (each is a submit button, so the dialog closes with it) and the
   * first one available starts focused. entries: [{label, detail, icon,
   * disabled, data}] (data: dataset entries, the test hooks).
   */
  function choiceList(label, entries, className = "") {
    const list = document.createElement("div");
    list.className = ["ui-dialog-choices", className].filter(Boolean).join(" ");
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", label);
    for (const entry of entries) {
      const button = document.createElement("button"), text = document.createElement("span"), name = document.createElement("b");
      button.type = "submit";
      button.className = "ui-dialog-choice";
      button.disabled = Boolean(entry.disabled);
      Object.assign(button.dataset, entry.data ?? {});
      if (entry.icon) button.insertAdjacentHTML("beforeend", glyph(entry.icon));
      text.className = "ui-dialog-choice-text";
      name.textContent = entry.label;
      text.append(name);
      if (entry.detail) {
        const detail = document.createElement("small");
        detail.textContent = entry.detail;
        text.append(detail);
      }
      button.append(text);
      list.append(button);
    }
    const first = list.querySelector(".ui-dialog-choice:not(:disabled)");
    if (first) first.autofocus = true;
    installRovingFocus(list, { items: ".ui-dialog-choice", orientation: "vertical", loop: false });
    return list;
  }

  /**
   * Asks before the open document is replaced while it has unsaved changes:
   * Save (the primary: the dialog stays open while saving and closes once the
   * project is saved), Don't save, or Cancel (Escape and × too). Resolves
   * true when the document may be replaced.
   */
  async function confirmReplace() {
    finishCurrentEdit();
    if (!editor.dirty) return true;
    const dialog = dialogOf({
      size: "sm",
      title: `Save changes to ${editor.name || "Untitled"}?`,
      body: "Your changes will be lost if you don't save them.",
      actions: [
        { label: "Don't save", value: "discard", id: "discard-changes", variant: "ghost", tone: "danger" },
        { label: kitText(t, "common.cancel"), cancel: true, id: "keep-editing", variant: "ghost" },
        { label: "Save", value: "save", id: "save-changes", variant: "primary", autofocus: true },
      ],
      onSubmit: (value) => {
        if (value !== "save") return undefined;
        void save();
        return false;
      },
    });
    const save = guarded(async () => {
      dialog.setBusy(true);
      try {
        if (await saveNative()) dialog.close("save");
      } finally {
        if (dialog.open) {
          dialog.setBusy(false);
          dialog.element.querySelector("#save-changes")?.focus({ preventScroll: true });
        }
      }
    });
    const choice = await dialog.showModal();
    return choice === "save" || choice === "discard";
  }
  /** The source features a Pivot or Stick Nodes import may show differently. */
  function showImportNotes(warnings, { pivot = false } = {}) {
    const list = document.createElement("ul");
    list.className = "import-notes";
    for (const warning of warnings) {
      const item = document.createElement("li");
      item.textContent = warning.message;
      list.append(item);
    }
    const dialog = dialogOf({
      size: "sm",
      className: "import-notes-dialog",
      title: pivot ? "Pivot import notes" : "Stick Nodes import notes",
      description: "The asset is ready to edit. These source features may look or behave differently:",
      body: list,
      actions: [{ label: kitText(t, "overlays.ok"), value: true, variant: "primary" }],
    });
    void dialog.showModal();
  }
  /** Which asset of a Stick Nodes pack to import: its index, or null when the dialog closes. */
  async function chooseSticknodesEntry(entries) {
    const dialog = dialogOf({
      size: "sm",
      title: "Choose a Stick Nodes asset",
      description: `This pack contains ${entries.length} ${entries.length === 1 ? "asset" : "assets"}.`,
      body: choiceList("Assets", entries.map((entry) => ({ label: entry.name, icon: "person", data: { sticknodesEntry: String(entry.index) } }))),
      actions: [{ label: kitText(t, "common.cancel"), cancel: true, variant: "ghost" }],
      onSubmit: (value, form, submitter) => (submitter?.dataset.sticknodesEntry === undefined ? false : { value: Number(submitter.dataset.sticknodesEntry) }),
    });
    return dialog.showModal();
  }
  /** Asks before Simple mode restores a frame's saved pose; Discard is the default, as before. */
  async function confirmDiscardFrame() {
    const dialog = dialogOf({
      size: "sm",
      title: "Discard frame changes?",
      body: "Restore the frame to its saved pose? You can undo this change.",
      actions: [
        { label: "Keep changes", cancel: true, id: "keep-frame-draft", variant: "ghost" },
        { label: "Discard", value: true, id: "discard-frame-draft", variant: "primary" },
      ],
    });
    return (await dialog.showModal()) === true;
  }
  function showPerformance() {
    const presentation = playbackMetrics.snapshot(performance.now());
    const sorted = [...state.renderSamples].sort((a, b) => a - b),
      p = (n) =>
        sorted[
          Math.min(sorted.length - 1, Math.floor(sorted.length * n))
        ]?.toFixed(2) || "—";
    const rows = [
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
    ];
    const body = document.createDocumentFragment(), table = document.createElement("table");
    table.className = "metric-table";
    for (const [name, value] of rows) {
      const row = table.insertRow();
      row.insertCell().textContent = name;
      row.insertCell().textContent = String(value);
    }
    body.append(table, paragraph("CPU submission timings include geometry evaluation and selection overlays. They do not measure GPU completion or input-to-display latency. Performance varies with hardware, scene complexity, effects, and media.", "ui-dialog-desc performance-note"));
    // The editor's recent activity (there is no status bar): newest first, a problem marked.
    const activity = ctx.activity?.() ?? [];
    const clock = (time) => new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    if (activity.length) {
      const heading = document.createElement("h3"), list = document.createElement("ol");
      heading.className = "ui-dialog-section-title";
      heading.textContent = "Activity";
      list.className = "performance-activity";
      for (const entry of activity.slice(0, 12)) {
        const item = document.createElement("li"), time = document.createElement("time");
        time.textContent = clock(entry.time);
        item.append(time, ` ${entry.text}`);
        if (entry.error) item.dataset.tone = "error";
        list.append(item);
      }
      body.append(heading, list);
    }
    const report = () => [...rows.map(([name, value]) => `${name}: ${value}`), "", ...activity.map((entry) => `${clock(entry.time)} ${entry.error ? "! " : ""}${entry.text}`)].join("\n");
    const dialog = dialogOf({
      size: "md",
      id: "performance-dialog",
      title: "Performance",
      body,
      actions: [
        { label: "Copy report", id: "copy-performance-report", value: "copy", variant: "ghost" },
        { label: kitText(t, "common.close"), cancel: true, variant: "secondary" },
      ],
      // Copy report keeps the dialog open: the numbers and the activity, for a bug report.
      onSubmit: (value) => {
        if (value !== "copy") return undefined;
        navigator.clipboard?.writeText(report()).then(() => dialog.setMeta("Copied"), () => dialog.setMeta("Could not copy"));
        return false;
      },
    });
    void dialog.showModal();
  }
  /** Recent files (desktop): pick one to open it (after the list closes); Clear history empties the list in place. */
  async function showRecentFiles() {
    pause();
    const entries = await desktop.listRecentFiles();
    const empty = () => paragraph("No recent files.");
    const list = entries.length
      ? choiceList("Recent files", entries.map((entry) => ({
        label: entry.name, detail: `${entry.directory}${entry.missing ? " · Unavailable" : ""}`, icon: "file",
        disabled: entry.missing, data: { recentId: entry.id },
      })), "recent-files")
      : Object.assign(document.createElement("div"), { className: "recent-files" });
    if (!entries.length) list.append(empty());
    const dialog = dialogOf({
      size: "sm",
      title: "Recent files",
      body: list,
      actions: [
        ...(entries.length ? [{ label: "Clear history", value: "clear", id: "clear-recent", variant: "ghost" }] : []),
        { label: kitText(t, "common.close"), cancel: true, variant: "ghost" },
      ],
      onSubmit: (value, form, submitter) => {
        if (submitter?.dataset.recentId) return { value: { recent: submitter.dataset.recentId } };
        if (value === "clear") void clear();
        return false;
      },
    });
    const clear = guarded(async () => {
      dialog.setBusy(true);
      try {
        await desktop.clearRecentFiles();
        if (!dialog.open) return;
        list.replaceChildren(empty());
        list.removeAttribute("role");
        const button = dialog.element.querySelector("#clear-recent");
        if (button) button.hidden = true;
        dialog.element.querySelector(".ui-dialog-foot button:not([hidden])")?.focus({ preventScroll: true });
      } finally {
        dialog.setBusy(false);
      }
    });
    // The command finishes once the list shows, as before; the file opens after the dialog closes.
    void dialog.showModal().then((choice) => {
      if (choice?.recent) guarded(async () => acceptNativeFile(await desktop.openRecentFile(choice.recent)))();
    });
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
        icon: glyph,
        t,
      });
      if (name === null) return;
      editor.name = name.trim() || "Untitled";
      editor.dirty = true;
      updateTitle();
    },
    "open-recent": showRecentFiles,
    performance: showPerformance,
  });
  async function chooseRecovery(records, discard) {
    const body=document.createDocumentFragment(), label=document.createElement('label'), select=document.createElement('select'), wrap=document.createElement('span');
    label.className='ui-form-row';label.textContent='Recovery copy';wrap.className='ui-select';wrap.innerHTML=icon('chevron-down');
    select.setAttribute('aria-label','Recovery copy');
    for(const record of records){const option=document.createElement('option');option.value=record.id;option.textContent=`${record.name || 'Untitled'} · ${new Date(record.savedAt).toLocaleString()}`;select.append(option);}
    wrap.prepend(select);label.append(wrap);body.append(label,paragraph('Restore opens this copy as an edited project. Discard permanently removes this recovery copy.'));
    const dialog=dialogOf({title:'Restore unsaved work',size:'sm',body,
      actions:[{label:'Cancel',cancel:true},{label:'Discard copy',value:'discard',tone:'danger'},{label:'Restore',value:'restore',variant:'primary'}],
      onSubmit:value=>{
        const record=records.find(copy=>copy.id===select.value);
        if(value==='restore')return {value:record};
        if(value==='discard'){
          dialog.setBusy(true);
          void discard(record).then(deleted=>{
            if(!deleted)throw new Error('The recovery copy changed or is open in another tab.');
            records.splice(records.indexOf(record),1);
            select.selectedOptions[0].remove();if(!select.options.length)dialog.close();
          }).catch(error=>dialog.setError(error.message)).finally(()=>dialog.setBusy(false));
          return false;
        }
        return false;
      },
    });
    return dialog.showModal();
  }
  return { confirmReplace, showImportNotes, chooseSticknodesEntry, confirmDiscardFrame, showPerformance, chooseRecovery };
}
