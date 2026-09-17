import {documentHasRigConstraints} from './rig-constraints.mjs';
import {documentHasSurfaces} from './pivot/surfaces.mjs';
import {applyDocumentChunk} from './document-transport.mjs';
import {diagnosticDetails} from './telemetry-schema.mjs';
import {validateScene} from './pivot/model.mjs';
import {synchronizeExistingDerived} from './document-normalize.mjs';
import {materializePivotDocument} from './pivot-export-materialize.mjs';
import {validateAnimationDocument} from './animation-channels.mjs';
import {materializeStyledFigureForStk} from './pivot-style-materialize.mjs';
import {nativeFigureDocument} from './native-figure.mjs';
import {validateMovieclipGraph,isMovieclip} from './movieclips.mjs';
import {packPoseSequences} from './pose-sequence-storage.mjs';
import {documentHasVfx} from './vfx.mjs';
import {liftDocument, encodeContainerV2, validateNativeFigure} from './native-container.mjs';
import {flattenDrawingFigures} from './drawing-flatten.mjs';

let document, config, running = false;
const timings = {};
function reply(id, payload) { self.postMessage({id, ok: true, ...payload}); }

/** Fetch the retained original binary source for native-save provenance.
 * Returns {meta, bytes} or null when the cache holds no binary source. */
async function fetchOriginalSource() {
  const headers = {};
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  const response = await fetch(new URL(`/api/source?id=${encodeURIComponent(config.sourceId)}`, config.baseURL), {headers});
  if (response.status === 422 || response.status === 404) return null;
  if (!response.ok) throw Object.assign(new Error(`The original source is unavailable (${response.status}).`), {status: response.status});
  const buffer = new Uint8Array(await response.arrayBuffer());
  const magic = new TextDecoder().decode(buffer.subarray(0, 8));
  if (magic !== 'STYKSRC1' || buffer.byteLength < 12) throw new Error('The file service returned an invalid source record.');
  const metaLength = new DataView(buffer.buffer, buffer.byteOffset).getUint32(8, true);
  const meta = JSON.parse(new TextDecoder().decode(buffer.subarray(12, 12 + metaLength)));
  const bytes = buffer.subarray(12 + metaLength);
  return {meta, bytes};
}

/** Build the native container in this worker: the editable document becomes a
 * compact skeleton plus binary sections instead of one large JSON payload. */
async function buildNativeContainer() {
  const output = config.format === 'styk' ? packPoseSequences(document) : {...document};
  if (config.format !== 'styk') {
    delete output._stykSource;
    validateNativeFigure(output, config.format);
  }
  output._styk = {...output._styk, format: 'StykAnimate', format_version: 1};
  let preBlobs = [], sourceMeta = null;
  if (config.format === 'styk' && config.sourceId) {
    const source = await fetchOriginalSource();
    if (source) { preBlobs = [source.bytes]; sourceMeta = source.meta; }
  }
  const lifted = liftDocument(output, {preBlobs});
  if (sourceMeta) lifted.skeleton._stykSource = {...sourceMeta, source_base64: `S2S:1:0:${preBlobs[0].byteLength}`};
  return encodeContainerV2(lifted, config.format);
}

self.addEventListener('message', async event => {
  const message = event.data;
  if (running) { self.postMessage({id: message.id, ok: false, error: {message: 'The document export worker is busy.', telemetryCode: 'worker_busy', telemetryStage: 'prepare'}}); return; }
  running = true;
  let stage = 'prepare';
  try {
    if (message.operation === 'start') {
      config = message.options;
      document = undefined;
      reply(message.id);
    } else if (message.operation === 'chunk') {
      document = applyDocumentChunk(document, message.chunk);
      reply(message.id);
    } else if (message.operation === 'export') {
      if (!document || !config) throw new Error('The document snapshot was not initialized.');
      const started = performance.now();
      document._styk = {...document._styk, format: 'StykAnimate', format_version: 1,
        ...(config.name ? {name: config.name} : {})};
      for (const frame of document.keyframes || []) for (const object of frame.objects || []) delete object.runtime_segments;
      stage = 'validate';
      if(['piv','stk'].includes(config.format)&&documentHasVfx(document))throw Object.assign(new Error('Pivot files cannot preserve VFX. Save as .styk, .stkz or .stykmov to keep effects editable, or export an image/video.'),{telemetryCode:'unsupported_feature'});
      validateAnimationDocument(document);
      validateMovieclipGraph(document);
      if (config.format === 'stkz' || config.format === 'stykmov') {
        document = nativeFigureDocument(document, config);
        if(config.format==='stykmov'&&!isMovieclip(document.figure_types[0]))throw new Error('Select a movieclip to export as .stykmov.');
        config.sourceId = undefined;
        config.name = document._styk.name;
      }
      if(['piv','stk'].includes(config.format)) {
        if(documentHasRigConstraints(document)||documentHasSurfaces(document))throw Object.assign(new Error('Pivot cannot preserve connectors, Smart Stretch or one-sided fills. Save as .styk or .stkz to keep the figure editable, or export SVG, images or video.'),{telemetryCode:'unsupported_feature'});
        const visited=new Set(),hasSourceShapes=doc=>{
          if(visited.has(doc))return false;visited.add(doc);
          return doc.figure_types.some(f=>f.segments.some(s=>s._sticknodes)||
            (f._styk?.movieclip&&hasSourceShapes(f._styk.movieclip.document)))||
            doc.keyframes.some(f=>f.objects.some(o=>o._sticknodesSprite));
        };
        if(hasSourceShapes(document))throw Object.assign(new Error('Pivot cannot retain these Stick Nodes shapes. Save as .styk, .stykmov or .stkz to keep them editable, or export SVG, PNG or video.'), {telemetryCode: 'unsupported_feature'});
      }
      if (['piv','stk'].includes(config.format)) {
        // Pivot formats cannot carry tile blobs: drawing cels flatten into
        // ordinary sprites at source resolution (largest mip level past the
        // 16 Mpx cap), with anchors rewritten so placement is identical.
        const flattenStats = {}, flattening = performance.now();
        timings.drawing_flattens = await flattenDrawingFigures(document, {stats: flattenStats});
        if (flattenStats.downsampled) timings.drawing_downsampled = flattenStats.downsampled;
        timings.drawing_flatten_ms = +(performance.now() - flattening).toFixed(3);
      }
      if (config.format === 'piv') {
        const composing = performance.now(), originalFrames = document.keyframes.length;
        document = materializePivotDocument(document);
        timings.compose_ms = performance.now() - composing;
        timings.source_keyframes = originalFrames; timings.export_keyframes = document.keyframes.length;
      } else if (config.format === 'stk') {
        if(isMovieclip(document.figure_types.find(f=>f.figure_type_id===config.figureTypeId)))
          throw Object.assign(new Error('Save movieclips as .stykmov. Use Break apart to export a still figure to Pivot.'), {telemetryCode: 'unsupported_feature'});
        const resolved = materializeStyledFigureForStk(document, config);
        document = resolved.report; config.figureTypeId = resolved.figureTypeId;
      }
      if(['piv','stk'].includes(config.format)) {
        const figures=config.format==='stk'?document.figure_types.filter(f=>f.figure_type_id===config.figureTypeId):document.figure_types;
        const unsupported=p=>p && p.type!=='solid' && (p.type!=='linear'||p.angle%360!==0||p.stops.length!==2||p.stops[0].offset!==0||p.stops[1].offset!==1);
        // Native text gradients run vertically per glyph. A paint fill spans
        // the entire text run, even when it is a two-stop linear gradient.
        if(figures.some(f=>f.segments.some(s=>unsupported(s.paint)||s.paint&&s.paint.type!=='solid'&&(s.primitive_code===5||s.segment_type==='text'))) || (config.format==='piv' && document.backgrounds?.some(b=>b.paint&&b.paint.type!=='solid')))
          throw Object.assign(new Error('Pivot files cannot represent these gradient fills. Save as .styk to keep editable gradients, or export SVG, PNG or video to preserve their appearance.'), {telemetryCode: 'unsupported_feature'});
      }
      synchronizeExistingDerived(document);
      // Zero stored frames are a valid native PIV boundary. The materializer
      // already validated the editable placeholder before removing it; retain
      // full figure-table validation without inventing an exported exposure.
      validateScene(config.format === 'piv' && document.keyframes.length === 0
        ? {...document, keyframes: [{objects: [], duration_raw: 0}]} : document);
      timings.normalize_ms = performance.now() - started;
      stage = 'serialize';
      let blob = null;
      if (['styk', 'stkz', 'stykmov'].includes(config.format)) {
        const building = performance.now();
        try {
          blob = new Blob([await buildNativeContainer()]);
          timings.container_build_ms = +(performance.now() - building).toFixed(3);
        } catch (error) {
          // A capacity rejection also applies to the JSON service fallback.
          // Preserve that actionable error instead of attempting an even larger
          // string and replacing it with a V8 "Invalid string length" failure.
          if (error?.code === 'document_too_large') throw error;
          // The service path remains authoritative for unusual documents and
          // produces the same user-facing errors on genuinely invalid input.
          timings.local_build_error = error?.message || String(error);
        }
      }
      if (!blob) {
        const serializing = performance.now();
        const body = JSON.stringify({document: config.format === 'styk' ? packPoseSequences(document) : document, sourceId: config.sourceId, format: config.format,
          filename: config.name, figureTypeId: config.figureTypeId});
        timings.stringify_ms = performance.now() - serializing;
        timings.json_characters = body.length;
        // Fetch consumes the large JSON body in this worker. Passing a string or
        // expanded document back to the main thread would recreate the freeze.
        const sending = performance.now();
        const headers = {'Content-Type': 'application/json'};
        if (config.token) headers.Authorization = `Bearer ${config.token}`;
        stage = 'request';
        const response = await fetch(new URL('/api/export', config.baseURL), {method: 'POST', headers, body});
        if (!response.ok) {
          const text = await response.text();
          let details;
          try { details = JSON.parse(text); } catch { /* Preserve status for non-JSON failures. */ }
          const error = new Error(details?.error?.message || details?.error || `Document export failed (${response.status}).`);
          error.status = response.status; error.code = details?.code;
          error.telemetryCode = response.status >= 500 ? 'backend_unavailable' : 'backend_rejected';
          throw error;
        }
        blob = await response.blob();
        timings.fetch_ms = performance.now() - sending;
      }
      timings.worker_ms = performance.now() - started;
      timings.output_bytes = blob.size;
      document = null;
      reply(message.id, {blob, timings});
    } else throw new Error('Unknown document export operation.');
  } catch (error) {
    document = null;
    self.postMessage({id: message.id, ok: false, error: {message: error?.message || String(error),
      code: error?.code, status: error?.status,
      ...diagnosticDetails(error,stage,stage === 'validate' ? 'invalid_document' : stage === 'serialize' ? 'serialize_failed' : stage === 'request' ? 'backend_unavailable' : 'snapshot_failed')}});
  } finally { running = false; }
});
