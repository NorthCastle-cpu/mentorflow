import { state, studentById, TASK_STATUS } from '../store.js';
import { esc, fmtDate, todayStr, ymd, addDays } from '../util.js';
import { icon, emptyState, chip, avatar } from '../ui.js';
import { ui } from '../uistate.js';
import { labelHex } from '../forms.js';
import { taskRow } from './today.js';

export const title = 'Tasks';
const order = ['todo', 'doing', 'done'];

function card(t) {
  const st = t.studentId ? studentById(t.studentId) : null;
  const overdue = t.due && t.due < todayStr() && t.status !== 'done';
  const i = order.indexOf(t.status);
  return `<article class="k-card" draggable="true" data-drag-id="${t.id}">
    <button class="k-main" data-action="edit-task" data-id="${t.id}"><b>${esc(t.title)}</b>
      <span class="k-meta">${st ? `<span class="k-stu" style="--lbl:${labelHex(st.labelColor)}">${esc(st.name)}</span>` : ''}${t.due ? `<span class="${overdue ? 'overdue' : ''}">${icon('clock')} ${esc(fmtDate(t.due, { day: 'numeric', month: 'short' }))}</span>` : ''}</span>
      ${t.notes ? `<small class="muted">${esc(t.notes.slice(0, 90))}</small>` : ''}</button>
    <div class="k-move">${i > 0 ? `<button class="icon-btn" data-action="move-task" data-id="${t.id}" data-status="${order[i - 1]}" aria-label="Move to ${TASK_STATUS[order[i - 1]]}">${icon('chevL')}</button>` : '<span></span>'}
    ${i < 2 ? `<button class="icon-btn" data-action="move-task" data-id="${t.id}" data-status="${order[i + 1]}" aria-label="Move to ${TASK_STATUS[order[i + 1]]}">${icon('chevR')}</button>` : ''}</div></article>`;
}

export function render() {
  const board = ui.taskBoard; const mode = ui.taskMode;
  let tasks = state.tasks.filter(t => t.type === board);
  if (board === 'homework' && ui.taskStudent) tasks = tasks.filter(t => t.studentId === ui.taskStudent);
  tasks.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.title.localeCompare(b.title));
  const tools = `<div class="view-tools">
    <div class="seg compact"><button class="${board === 'mine' ? 'on' : ''}" data-action="task-board" data-board="mine">My Tasks <span class="count">${state.tasks.filter(t => t.type === 'mine' && t.status !== 'done').length}</span></button><button class="${board === 'homework' ? 'on' : ''}" data-action="task-board" data-board="homework">Homework <span class="count">${state.tasks.filter(t => t.type === 'homework' && t.status !== 'done').length}</span></button></div>
    ${board === 'homework' ? `<select class="compact-select" data-change="task-student" aria-label="Filter by student"><option value="">All students</option>${state.students.filter(s => s.active !== false).sort((a, b) => a.name.localeCompare(b.name)).map(s => `<option value="${s.id}" ${ui.taskStudent === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
    <div class="seg compact"><button class="${mode === 'kanban' ? 'on' : ''}" data-action="task-mode" data-mode="kanban">${icon('board')} Board</button><button class="${mode === 'list' ? 'on' : ''}" data-action="task-mode" data-mode="list">${icon('list')} List</button></div></div>`;
  let body;
  if (!state.tasks.filter(t => t.type === board).length) {
    body = `<div class="card">${emptyState('tasks', board === 'mine' ? 'No tasks yet' : 'No homework yet', board === 'mine' ? 'Keep track of admin, prep and reminders.' : 'Set homework and move it across the board as students progress.', `<button class="btn primary small" data-action="new-task" data-type="${board}">${icon('plus')} ${board === 'mine' ? 'Add task' : 'Add homework'}</button>`)}</div>`;
  } else if (mode === 'kanban') {
    body = `<div class="kanban">${order.map(s => { const col = tasks.filter(t => t.status === s); return `<section class="k-col" data-drop="${s}"><header><h3>${TASK_STATUS[s]}</h3><span class="count">${col.length}</span><button class="icon-btn" data-action="new-task" data-type="${board}" data-status="${s}" aria-label="Add to ${TASK_STATUS[s]}">${icon('plus')}</button></header><div class="k-list">${col.map(card).join('') || `<p class="k-empty">Drop here</p>`}</div></section>`; }).join('')}</div>`;
  } else {
    const t = todayStr(), wk = ymd(addDays(new Date(), 7));
    const groups = [['Overdue', x => x.status !== 'done' && x.due && x.due < t], ['Today', x => x.status !== 'done' && x.due === t], ['Next 7 days', x => x.status !== 'done' && x.due > t && x.due <= wk], ['Later', x => x.status !== 'done' && x.due > wk], ['No due date', x => x.status !== 'done' && !x.due], ['Done', x => x.status === 'done']];
    body = groups.map(([label, fn]) => { const l = tasks.filter(fn); return l.length ? `<section class="card"><header class="card-head"><h3>${label}</h3><span class="count">${l.length}</span></header><div class="list">${l.map(taskRow).join('')}</div></section>` : ''; }).join('');
  }
  return { html: tools + body, actions: `<button class="btn primary" data-action="new-task" data-type="${board}">${icon('plus')}<span class="hide-sm"> ${board === 'mine' ? 'Task' : 'Homework'}</span></button>` };
}
