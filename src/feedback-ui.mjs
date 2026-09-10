const css = `
.styk-feedback{width:480px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box;padding:24px;border:1px solid #dce5ed;border-radius:12px;background:#fff;color:#253543;box-shadow:0 22px 80px #1b2b4838;font:13px/1.6 Inter,'Segoe UI',sans-serif}.styk-feedback::backdrop{background:#18223340;backdrop-filter:blur(3px)}.styk-feedback *{box-sizing:border-box}.styk-feedback header{display:flex;align-items:center;justify-content:space-between;gap:16px}.styk-feedback h2{margin:0;font-size:20px;line-height:1.3;letter-spacing:-.4px}.styk-feedback .feedback-close{border:0;background:transparent;color:#657483;width:30px;height:30px;border-radius:5px;font-size:23px;cursor:pointer}.styk-feedback p{margin:12px 0;color:#62717f}.styk-feedback label{display:block;margin-top:14px;font-weight:600}.styk-feedback select,.styk-feedback textarea{display:block;width:100%;margin-top:6px;padding:10px;border:1px solid #ccd9e2;border-radius:6px;background:#fff;color:inherit;font:inherit;font-weight:400}.styk-feedback textarea{min-height:150px;resize:vertical}.styk-feedback .feedback-note{font-size:11px;line-height:1.6}.styk-feedback footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px}.styk-feedback .feedback-count{font-size:11px;color:#7b8793}.styk-feedback [type=submit]{padding:10px 16px;border:0;border-radius:6px;background:#0d99ff;color:#fff;font:inherit;font-weight:600;cursor:pointer}.styk-feedback [type=submit]:disabled{opacity:.6;cursor:wait}.styk-feedback :focus-visible{outline:2px solid #0d99ff;outline-offset:3px}.styk-feedback [role=status]{color:#187448}.styk-feedback [role=alert]{color:#b42318}.styk-feedback [hidden]{display:none!important}
`;

/** All entry points share one draft and the existing explicit-feedback bridge. */
export class FeedbackUI {
  constructor(bridge) { this.bridge = bridge; this.busy = false; }
  open({category} = {}) {
    if (!this.bridge?.sendTelemetryFeedback) return;
    if (!this.dialog) this.create();
    if (!this.busy && ['bug','idea','other'].includes(category)) this.form.elements.category.value = category;
    if (!this.dialog.open) this.dialog.showModal();
    this.form.elements.message.focus();
  }
  create() {
    const style = document.createElement('style'); style.textContent = css; document.head.append(style);
    this.dialog = document.createElement('dialog'); this.dialog.className = 'styk-feedback';
    this.dialog.setAttribute('aria-labelledby','feedback-title');
    this.dialog.innerHTML = `<header><h2 id="feedback-title">Send feedback or report a bug</h2><button class="feedback-close" type="button" aria-label="Close feedback">×</button></header>
      <p>Found a bug or have an idea? Let me know.</p><form>
      <label>Type<select name="category"><option value="bug">Bug report</option><option value="idea">Idea or suggestion</option><option value="other">Other feedback</option></select></label>
      <label>Message<textarea name="message" placeholder="What happened, and what did you expect? For bugs, include the steps to reproduce it." required minlength="5" maxlength="2000"></textarea></label>
      <p class="feedback-note">This form works even when optional diagnostics are off. No project or screenshot is attached. Please leave out private details. Feedback is kept for 90 days.</p>
      <p role="status" aria-live="polite" hidden></p><p role="alert" hidden></p>
      <footer><span class="feedback-count">0 / 2,000 characters</span><button type="submit">Send feedback</button></footer></form>`;
    document.body.append(this.dialog); this.form = this.dialog.querySelector('form');
    this.dialog.querySelector('.feedback-close').onclick = () => this.dialog.close();
    this.dialog.addEventListener('keydown',event=>event.stopPropagation());
    this.dialog.addEventListener('click',event=>event.stopPropagation());
    this.form.elements.message.addEventListener('input',()=>{
      this.form.elements.message.setCustomValidity(''); this.updateCount();
      this.dialog.querySelector('[role=status]').hidden = true;
    });
    this.form.addEventListener('submit',event=>{event.preventDefault();void this.send();});
  }
  updateCount() { this.dialog.querySelector('.feedback-count').textContent = `${this.form.elements.message.value.length.toLocaleString('en-US')} / 2,000 characters`; }
  async send() {
    if (this.busy) return;
    const field = this.form.elements.message, message = field.value.trim();
    field.setCustomValidity(message.length < 5 ? 'Please enter at least 5 characters.' : '');
    if (!this.form.reportValidity()) return;
    const status = this.dialog.querySelector('[role=status]'), error = this.dialog.querySelector('[role=alert]'), button = this.form.querySelector('[type=submit]');
    const category = this.form.elements.category.value;
    this.busy = true; button.disabled = true; field.disabled = true; this.form.elements.category.disabled = true;
    status.hidden = true; error.hidden = true; button.textContent = 'Sending…';
    try {
      await this.bridge.sendTelemetryFeedback({category,message});
      field.value = ''; this.updateCount();
      status.textContent = 'Feedback sent. Thank you for helping improve StykAnimate!'; status.hidden = false;
    } catch (reason) {
      error.textContent = reason?.message || 'Feedback could not be sent. Please try again.'; error.hidden = false;
    } finally {
      this.busy = false; button.disabled = false; field.disabled = false; this.form.elements.category.disabled = false; button.textContent = 'Send feedback';
    }
  }
}
