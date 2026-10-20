// Ephemeral view state (selected month, modes). Persisted to sessionStorage so reloads keep context.
import { ym, todayStr } from './util.js';
const KEY = 'mentorflow-ui';
const defaults = () => ({ month: ym(new Date()), date: todayStr(), sessionsMode: 'calendar', taskBoard: 'mine', taskMode: 'kanban', taskStudent: '', studentQuery: '', studentFilter: 'active', moneyMonth: ym(new Date()), expMonth: ym(new Date()) });
let saved = {};
try { saved = JSON.parse(sessionStorage.getItem(KEY) || '{}'); } catch {}
export const ui = { ...defaults(), ...saved };
export function setUi(patch) { Object.assign(ui, patch); try { sessionStorage.setItem(KEY, JSON.stringify(ui)); } catch {} }
