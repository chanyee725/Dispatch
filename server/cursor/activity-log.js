// Pure part of the agent activity log (E537, issue #654): turns the cursor module's "who holds which file" reports
// and the hub's session states into start / progress / finish / error events. No I/O, so it runs under `node --test`.
// Metadata only: who (session name, role, provider, colour), which file and section, when, what kind.
//
//   start    a session's first credited edit of a file (or of another file than the one it held)
//   progress it moved on from one section of the document to another (once per section and stay)
//   finish   it left the file: it went on to another file, or its turn ended or it was removed (the cursor
//            module reports that after a short grace, so a last edit still on its way does not start a new stay)
//   error    its monitoring state turned failed or stuck while it held a file (once per stay)

const BAD = new Set(['failed', 'stuck']);

/**
 * emit(event without id) is called for every new event, in order. `session(sid)` gives the hub's session (name,
 * role, provider, colour, status, state) or null.
 */
export function createActivityLog({ emit, session = () => null, now = Date.now }) {
  const stays = new Map(); // sid -> { file, section, done: Set<section>, failed }

  const who = (sid) => {
    const s = session(sid);
    return {
      sid,
      name: typeof s?.name === 'string' ? s.name : '',
      role: typeof s?.role === 'string' ? s.role : '',
      // Provider id (claude, openai, gemini) for the 알림함's model mark (#811).
      ...(typeof s?.provider === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(s.provider) ? { provider: s.provider } : {}),
      ...(typeof s?.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? { color: s.color } : {}),
    };
  };
  const put = (kind, sid, file, extra = {}) => emit({ at: now(), kind, ...who(sid), file, ...extra });

  const finish = (sid) => {
    const st = stays.get(sid);
    if (!st) return;
    stays.delete(sid);
    put('finish', sid, st.file);
  };

  /** A report from the cursor module: { sid, file, section? } (a credited edit) or { sid, gone: true }. */
  function held(e) {
    if (!e?.sid || e.outside) return;
    if (e.gone) return finish(e.sid);
    if (typeof e.file !== 'string' || !e.file) return;
    const section = typeof e.section === 'string' && e.section ? e.section : null;
    const st = stays.get(e.sid);
    if (!st || st.file !== e.file) {
      finish(e.sid);
      stays.set(e.sid, { file: e.file, section, done: new Set(), failed: false });
      put('start', e.sid, e.file);
      return;
    }
    if (!section || section === st.section) return;
    // Moved on: the section it just left counts as progressed (once per stay).
    if (st.section && !st.done.has(st.section)) {
      st.done.add(st.section);
      put('progress', e.sid, e.file, { section: st.section });
    }
    st.section = section;
  }

  /** A hub `session` update ({ id, status, state }). */
  function sessionUpdate(s) {
    const st = s?.id ? stays.get(s.id) : null;
    if (!st) return;
    if (BAD.has(s.state) && !st.failed) {
      st.failed = true;
      put('error', s.id, st.file);
    } else if (!BAD.has(s.state)) st.failed = false;
  }

  return { held, sessionUpdate, finish, get size() { return stays.size; } };
}
