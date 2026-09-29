import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Todo, TodoList, TodoTab, TodoStep } from '../types';
import { Check, ChevronRight, MoreVertical, CalendarIcon, Trash2, Plus, GripVertical, AlertCircle, X, Maximize2, CheckSquare, Layout, Edit3 } from '../components/Icons';
import { format, isToday, isTomorrow, isValid, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  defaultDropAnimationSideEffects,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  DropAnimation,
  rectIntersection,
  useDroppable,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getDarkAdaptiveColor, normalizeThemeColorValue, TODO_TAB_COLOR_OPTIONS } from '../utils/colorPalette';

interface TodoViewProps {
  todos: Todo[];
  lists: TodoList[];
  tabs: TodoTab[];
  steps: TodoStep[];
  onAddList: (title: string, tabId: string, dueDate?: string) => void;
  onUpdateList: (id: string, updates: Partial<TodoList>) => void;
  onUpdateListOrder?: (lists: TodoList[]) => void;
  onAddTodo: (text: string, listId?: string, dueDate?: string, stepId?: string) => void;
  onUpdateTodo?: (id: string, updates: Partial<Todo>) => void;
  onToggleTodo: (id: string) => void;
  onDeleteTodo: (id: string) => void;
  onDeleteList: (id: string) => void;
  onAddTab: (name: string, color: string) => void;
  onUpdateTab: (id: string, updates: Partial<TodoTab>) => void;
  onDeleteTab: (id: string) => void;
  onAddStep: (title: string, listId: string) => void;
  onUpdateStep: (id: string, updates: Partial<TodoStep>) => void;
  onDeleteStep: (id: string) => void;
  sidebarSlot?: HTMLElement | null;
}



const UNASSIGNED_TAB_FILTER = '__unassigned';
const UNASSIGNED_TAB_LABEL = '미분류';
const ADD_LIST_TILE = 'add-list-tile' as const;

// Checkbox Component
const Checkbox = ({ checked, onClick }: { checked: boolean; onClick: (e: React.MouseEvent) => void }) => (
  <button
    type="button"
    aria-pressed={checked}
    className={`todo-check-control ${checked ? 'is-checked' : 'is-unchecked'} w-[18px] h-[18px] mt-0.5 rounded-full border flex-shrink-0 cursor-pointer transition-all flex items-center justify-center
      ${checked
        ? 'bg-[var(--color-primary)] border-[var(--color-primary)]'
        : 'border-[#5f6368] hover:bg-[#e8eaed]'
      }`}
    onClick={onClick}
  >
    {checked && <Check size={11} className="text-white stroke-[3px]" />}
  </button>
);

const formatShortDate = (dateStr?: string) => {
  if (!dateStr) return null;
  const parsed = parseISO(dateStr);
  if (!isValid(parsed)) return null;
  try {
    return format(parsed, 'M.d');
  } catch {
    return null;
  }
};

// --- List Settings Modal (Date & Tab) ---
const ListSettingsModal = ({ listId, lists, tabs, defaultTabId, onClose, onUpdateList, onAddList }: any) => {
  const isEditing = !!listId;
  const list = isEditing ? lists.find((l: TodoList) => l.id === listId) : null;

  const [title, setTitle] = useState(list?.title || '');
  const [dueDate, setDueDate] = useState(list?.dueDate || '');
  const [tabId, setTabId] = useState<string>(list?.tabId || defaultTabId || tabs[0]?.id || '');

  const handleSave = () => {
    if (isEditing) {
      onUpdateList(listId, {
        dueDate: dueDate || undefined,
        tabId: tabId
      });
    } else {
      onAddList(title.trim() || "새 목록", tabId, dueDate || undefined);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-[#171717]/10 z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg border border-[#e9e9e8] w-full max-w-sm overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <h2 className="text-lg font-medium text-gray-800">
            {isEditing ? '목록 설정' : '새 목록 만들기'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-6">
          {!isEditing && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5 capital">목록 제목</label>
              <input
                autoFocus
                type="text"
                placeholder="제목을 입력하세요"
                className="w-full text-sm border-none bg-gray-50 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-[#d4d4d4] transition-all font-medium"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">탭(분류) 선택</label>
            <div className="grid grid-cols-2 gap-2 max-h-[160px] overflow-y-auto pr-1">
              {tabs.map((tab: TodoTab) => (
                <button
                  key={tab.id}
                  onClick={() => setTabId(tab.id)}
                  className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2 border-2 ${tabId === tab.id
                    ? 'border-[#d4d4d4] bg-white'
                    : 'border-transparent bg-gray-50 hover:bg-gray-100'
                    }`}
                >
                  <div
                    className="todo-tab-dot w-2.5 h-2.5 rounded-full"
                    style={{
                      '--todo-tab-color': tab.color,
                      '--todo-tab-dark-color': getDarkAdaptiveColor(tab.color),
                    } as React.CSSProperties}
                  />
                  <span className="truncate">{tab.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">마감 일자 (선택)</label>
            <input
              type="date"
              className="w-full text-sm border-none bg-gray-50 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-[#d4d4d4] transition-all"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition-colors">
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={!isEditing && !title.trim()}
            className="px-6 py-2 text-sm font-medium text-[#171717] bg-white border border-[#d4d4d4] hover:bg-[#f7f7f7] rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isEditing ? '저장' : '만들기'}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Tab Settings Modal ---
const TabSettingsModal = ({ tabId, tabs, onClose, onAddTab, onUpdateTab, onDeleteTab }: any) => {
  const isEditing = !!tabId;
  const tab = isEditing ? tabs.find((t: TodoTab) => t.id === tabId) : null;

  const [name, setName] = useState(tab?.name || '');
  const [color, setColor] = useState(normalizeThemeColorValue(tab?.color || 'var(--color-primary)'));

  const handleSave = () => {
    if (isEditing) {
      onUpdateTab(tabId, { name: name.trim(), color });
    } else {
      onAddTab(name.trim() || "새 탭", color);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-[#171717]/10 z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg border border-[#e9e9e8] w-full max-w-sm overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-800">
            {isEditing ? '탭 수정' : '새 탭 만들기'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5 capital">탭 이름</label>
            <input
              autoFocus
              type="text"
              placeholder="이름을 입력하세요"
              className="w-full text-sm border-none bg-gray-50 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-[#d4d4d4] transition-all font-medium"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">테마 색상</label>
            <div className="flex flex-wrap gap-3">
              {TODO_TAB_COLOR_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setColor(option.value)}
                  className={`todo-color-swatch flex w-8 h-8 items-center justify-center rounded-full transition-transform ${
                    color === option.value ? 'is-selected' : 'hover:scale-105'
                  }`}
                  style={{
                    '--todo-tab-color': option.value,
                    '--todo-tab-dark-color': option.dark,
                  } as React.CSSProperties}
                  aria-label={option.label}
                  aria-pressed={color === option.value}
                  title={option.label}
                >
                  {color === option.value && (
                    <Check size={16} strokeWidth={3} style={{ color: option.checkColor || '#ffffff' }} />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-between items-center">
          <div>
            {isEditing && (
              <button
                onClick={() => {
                  if (onDeleteTab(tabId)) onClose();
                }}
                className="text-xs text-red-600 font-medium hover:underline"
              >
                삭제하기
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition-colors">
              취소
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim()}
              className="px-6 py-2 text-sm font-medium text-[#171717] bg-white border border-[#d4d4d4] hover:bg-[#f7f7f7] rounded-lg transition-all disabled:opacity-50"
            >
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Expanded Todo Modal ---
const ExpandedTodoModal = ({ todoId, todos, lists, onClose, onUpdateTodo }: any) => {
  const todo = todos.find((t: Todo) => t.id === todoId);
  if (!todo) return null;

  const parentList = lists?.find((l: TodoList) => l.id === todo.listId);
  const maxDueDate = parentList?.dueDate || '';

  const [text, setText] = useState(todo.text);
  const [dueDate, setDueDate] = useState<string>(todo.dueDate || '');
  const [subTasks, setSubTasks] = useState<any[]>(todo.subTasks || []);
  const [newSubTask, setNewSubTask] = useState('');

  const handleSave = () => {
    onUpdateTodo(todoId, {
      text: text.trim(),
      dueDate: dueDate || undefined,
      subTasks: subTasks.length > 0 ? subTasks : undefined
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-[#171717]/10 z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg border border-[#e9e9e8] w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-800">상세 편집</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">할 일 내용</label>
            <textarea
              className="w-full text-sm text-gray-800 border-none bg-gray-50 rounded-lg px-3 py-2.5 resize-none focus:ring-2 focus:ring-[#d4d4d4] focus:bg-white transition-colors"
              rows={3}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="무엇을 해야 하나요?"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5 flex items-center justify-between">
              <span>마감 일자</span>
              {maxDueDate && (
                <span className="text-[10px] font-normal text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded">
                  목록 제약: ~ {maxDueDate}
                </span>
              )}
            </label>
            <input
              type="date"
              className="w-full text-sm border-none bg-gray-50 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-[#d4d4d4] transition-colors"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              max={maxDueDate || undefined}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5 flex items-center justify-between">
              <span>하위 작업 (체크리스트)</span>
              <span className="text-blue-500 font-medium">
                {subTasks.filter(s => s.completed).length} / {subTasks.length}
              </span>
            </label>
            <div className="space-y-2 mb-2">
              {subTasks.map((st, idx) => (
                <div key={st.id} className="flex items-center gap-2 group">
                  <Checkbox
                    checked={st.completed}
                    onClick={() => {
                      const updated = [...subTasks];
                      updated[idx].completed = !updated[idx].completed;
                      setSubTasks(updated);
                    }}
                  />
                  <input
                    className={`flex-1 text-sm bg-transparent border-transparent focus:border-[#d4d4d4] focus:ring-0 px-1 py-1 rounded transition-colors ${st.completed ? 'text-gray-400 line-through' : 'text-gray-700'}`}
                    value={st.text}
                    onChange={e => {
                      const updated = [...subTasks];
                      updated[idx].text = e.target.value;
                      setSubTasks(updated);
                    }}
                  />
                  <button
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                    onClick={() => setSubTasks(subTasks.filter(s => s.id !== st.id))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            <form onSubmit={e => {
              e.preventDefault();
              if (!newSubTask.trim()) return;
              setSubTasks([...subTasks, { id: crypto.randomUUID(), text: newSubTask.trim(), completed: false }]);
              setNewSubTask('');
            }} className="flex items-center gap-2 mt-2">
              <div className="w-4 h-4 ml-0.5 rounded-full border border-gray-300 flex-shrink-0" />
              <input
                className="flex-1 text-sm bg-gray-50 border-none rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#d4d4d4]"
                placeholder="하위 작업 추가..."
                value={newSubTask}
                onChange={e => setNewSubTask(e.target.value)}
              />
              <button type="submit" disabled={!newSubTask.trim()} className="p-2 text-blue-600 disabled:opacity-50">
                <Plus size={18} />
              </button>
            </form>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition-colors">
            취소
          </button>
          <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-[#171717] bg-white border border-[#d4d4d4] hover:bg-[#f7f7f7] rounded-lg transition-colors">
            저장
          </button>
        </div>
      </div>
    </div>
  );
};

// Sortable Todo Item Component
const SortableTodoItem = ({
  todo,
  isEditing,
  editingText,
  setEditingText,
  startEditing,
  saveTodo,
  cancelEditing,
  onToggle,
  onOpenMenu,
  getDueLabel,
  onUpdateTodo,
  hideBadge,
  isMobile,
}: any) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: todo.id,
    data: {
      type: 'Todo',
      todo,
    },
    disabled: isEditing || isMobile,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    touchAction: isMobile ? 'auto' : 'none',
    cursor: isMobile ? 'pointer' : (isDragging ? 'grabbing' : 'grab'),
  };

  const dueLabel = getDueLabel(todo.dueDate);
  const completedSubTasks = todo.subTasks?.filter((s: any) => s.completed).length || 0;
  const totalSubTasks = todo.subTasks?.length || 0;

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="opacity-40 bg-gray-50 border border-dashed border-gray-300 rounded px-3 py-2.5 h-[50px] mb-1"
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative px-3 py-2.5 rounded-lg hover:bg-[#f5f5f5] transition-all flex items-start gap-3 cursor-pointer ${isEditing ? 'bg-white ring-1 ring-[#d4d4d4] z-10' : ''}`}
      onClick={() => !isEditing && startEditing(todo)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (isEditing) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          startEditing(todo);
        }
      }}
      {...attributes}
      {...listeners}
    >
      <Checkbox checked={todo.completed} onClick={(e) => { e.stopPropagation(); onToggle(todo.id); }} />

      <div className="flex-1 min-w-0 ml-1">
        {isEditing ? (
          <input
            autoFocus
            value={editingText}
            onChange={(e) => setEditingText(e.target.value)}
            onBlur={saveTodo}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTodo();
              if (e.key === 'Escape') cancelEditing();
            }}
            className="w-full text-[14px] text-[#1f1f1f] bg-transparent border-b border-[var(--color-primary)] focus:outline-none"
            onPointerDown={e => e.stopPropagation()}
          />
        ) : (
          <p className="text-[14px] text-[#1f1f1f] leading-snug break-words">
            {todo.text}
          </p>
        )}

        <div className="flex flex-wrap gap-2 mt-1.5 items-center">
          {dueLabel && (
            <span className="block text-[11px] text-[#d93025] font-medium mr-1.5">
              {dueLabel}
            </span>
          )}
          {totalSubTasks > 0 && !hideBadge && (
            <span className={`block text-[11px] px-1.5 py-0.5 rounded font-medium ${completedSubTasks === totalSubTasks ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'}`}>
              {completedSubTasks}/{totalSubTasks} 완료
            </span>
          )}
        </div>

        {/* Subtasks List */}
        {!isEditing && totalSubTasks > 0 && (
          <div className="mt-2 space-y-1.5">
            {todo.subTasks?.map((st: any) => (
              <div
                key={st.id}
                className="flex items-start gap-1.5 group/subtask transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onUpdateTodo) {
                    const newSubTasks = todo.subTasks!.map((s: any) =>
                      s.id === st.id ? { ...s, completed: !s.completed } : s
                    );
                    onUpdateTodo(todo.id, { subTasks: newSubTasks });
                  }
                }}
              >
                <div className="mt-[2px] cursor-pointer">
                  {st.completed ? (
                    <div className="w-3.5 h-3.5 rounded bg-[var(--color-primary)] border border-[var(--color-primary)] flex items-center justify-center">
                      <Check size={10} className="text-white stroke-[3px]" />
                    </div>
                  ) : (
                    <div className="todo-subtask-check is-unchecked w-3.5 h-3.5 rounded border border-gray-300 group-hover/subtask:border-[#9bbcf3] bg-white transition-colors" />
                  )}
                </div>
                <span
                  className={`text-[12.5px] leading-snug cursor-pointer ${st.completed ? 'text-gray-400 line-through' : 'text-gray-700 group-hover/subtask:text-blue-600 transition-colors'
                    }`}
                >
                  {st.text}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!isEditing && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className="p-1 hover:bg-[#e0e0e0] rounded-full text-[#5f6368] transition-all"
            onClick={(e) => {
              e.stopPropagation();
              onOpenMenu(e, todo, 'expand');
            }}
            onPointerDown={e => e.stopPropagation()}
            title="상세 보기"
          >
            <Maximize2 size={14} />
          </button>
          <button
            className="p-1 hover:bg-[#e0e0e0] rounded-full text-[#5f6368] transition-all"
            onClick={(e) => {
              e.stopPropagation();
              onOpenMenu(e, todo, 'menu');
            }}
            onPointerDown={e => e.stopPropagation()}
            title="더보기"
          >
            <MoreVertical size={16} />
          </button>
        </div>
      )}
    </div>
  );
};

const TodoSectionRenderer = ({
  stepId,
  sectionTodos,
  isOver,
  setNodeRef,
  listId,
  editingTodoId,
  editingTodoText,
  setEditingTodoText,
  startEditingTodo,
  saveTodoText,
  cancelEditing,
  onToggleTodo,
  onOpenMenu,
  getDueLabel,
  onUpdateTodo,
  draft,
  setDraft,
  handleAdd,
  hideBadge,
  isMobile,
}: any) => {
  return (
    <div className={`${stepId ? 'min-h-[20px]' : 'min-h-0'} transition-colors ${isOver && (stepId || sectionTodos.length > 0) ? 'bg-blue-50/50 ring-2 ring-blue-100 rounded-lg' : ''}`} ref={setNodeRef}>
      <SortableContext
        id={stepId || `list-${listId}-general`}
        items={sectionTodos.map(t => t.id)}
        strategy={verticalListSortingStrategy}
      >
        {sectionTodos.map((todo) => (
          <SortableTodoItem
            key={todo.id}
            todo={todo}
            isEditing={editingTodoId === todo.id}
            editingText={editingTodoText}
            setEditingText={setEditingTodoText}
            startEditing={startEditingTodo}
            saveTodo={saveTodoText}
            cancelEditing={cancelEditing}
            onToggle={onToggleTodo}
            onOpenMenu={onOpenMenu}
            getDueLabel={getDueLabel}
            onUpdateTodo={onUpdateTodo}
            hideBadge={hideBadge}
            isMobile={isMobile}
          />
        ))}
      </SortableContext>

      {draft.stepId === stepId && draft.text !== '' && (
        <div className="mt-1 mx-1 mb-2 bg-white rounded-lg border border-gray-200">
          <input
            autoFocus
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd(stepId);
              if (e.key === 'Escape') setDraft({ text: '', stepId: null });
            }}
            placeholder="할 일 추가"
            className="w-full px-3 py-3 text-sm focus:outline-none bg-transparent"
            onPointerDown={e => e.stopPropagation()}
          />
        </div>
      )}


    </div>
  );
};

const DroppableSection = ({
  stepId,
  sectionTodos,
  listId,
  editingTodoId,
  editingTodoText,
  setEditingTodoText,
  startEditingTodo,
  saveTodoText,
  setEditingTodoId,
  onToggleTodo,
  setContextMenu,
  getDueLabel,
  onUpdateTodo,
  draft,
  setDraft,
  handleAdd,
  isMobile,
}: any) => {
  const { isOver, setNodeRef } = useDroppable({
    id: stepId || `list-${listId}-general`,
    data: {
      type: stepId ? 'Step' : 'ListGeneral',
      stepId,
      listId
    },
    disabled: isMobile,
  });

  return (
    <TodoSectionRenderer
      stepId={stepId}
      sectionTodos={sectionTodos}
      isOver={isOver}
      setNodeRef={setNodeRef}
      listId={listId}
      editingTodoId={editingTodoId}
      editingTodoText={editingTodoText}
      setEditingTodoText={setEditingTodoText}
      startEditingTodo={startEditingTodo}
      saveTodoText={saveTodoText}
      cancelEditing={() => { setEditingTodoId(null); setEditingTodoText(''); }}
      onToggleTodo={onToggleTodo}
      onOpenMenu={(e: any, t: Todo, actionType: 'menu' | 'expand') => {
        if (actionType === 'menu') {
          setContextMenu({ id: t.id, x: e.clientX, y: e.clientY });
        } else {
          setContextMenu({ id: t.id, x: 0, y: 0, expanded: true });
        }
      }}
      getDueLabel={getDueLabel}
      onUpdateTodo={onUpdateTodo}
      draft={draft}
      setDraft={setDraft}
      handleAdd={handleAdd}
      hideBadge={!!stepId}
      isMobile={isMobile}
    />
  );
};

// Sortable Column (List) Component
const SortableList = ({
  list,
  lists,
  todos,
  editingListId,
  editingListTitle,
  setEditingListTitle,
  saveListTitle,
  setEditingListId,
  startEditingList,
  handleMoveTodo,
  onAddTodo,
  onUpdateTodo,
  onToggleTodo,
  onDeleteTodo,
  editingTodoId,
  editingTodoText,
  setEditingTodoText,
  setEditingTodoId,
  startEditingTodo,
  saveTodoText,
  setContextMenu,
  setListMenu,
  getDueLabel,
  tabs,
  steps,
  onAddStep,
  onUpdateStep,
  onDeleteStep,
  isMobile,
}: any) => {
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: list.id,
    data: {
      type: 'List',
      list,
    },
    disabled: editingListId === list.id || isMobile,
  });

  const { isOver: isOverList, setNodeRef: setDroppableListRef } = useDroppable({
    id: `list-${list.id}-droppable`,
    data: {
      type: 'List',
      listId: list.id,
    },
    disabled: isMobile,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    touchAction: isMobile ? 'auto' : 'none',
  };

  const listTodos = todos.filter((t: Todo) => t.listId === list.id);
  const listSteps = steps.filter((s: TodoStep) => s.listId === list.id).sort((a: any, b: any) => a.order - b.order);
  const listTab = tabs?.find((t: any) => t.id === list.tabId);
  const [draft, setDraft] = useState<{ text: string; stepId?: string | null }>({ text: '', stepId: null });
  const [showCompleted, setShowCompleted] = useState(false);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editingStepTitle, setEditingStepTitle] = useState('');

  const handleAdd = (stepId?: string | null) => {
    if (!draft.text.trim()) return;
    onAddTodo(draft.text.trim(), list.id, undefined, stepId || undefined);
    setDraft({ text: '', stepId: null });
  };

  const commonSectionProps = {
    listId: list.id,
    editingTodoId,
    editingTodoText,
    setEditingTodoText,
    startEditingTodo,
    saveTodoText,
    setEditingTodoId,
    onToggleTodo,
    setContextMenu,
    getDueLabel,
    onUpdateTodo,
    draft,
    setDraft,
    handleAdd,
    isMobile,
  };

  if (isDragging) {
    return (
      <div
        ref={setSortableRef}
        style={style}
        className="min-w-[300px] w-[300px] h-[400px] bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg opacity-50"
      />
    );
  }

  return (
    <div
      ref={setSortableRef}
      style={style}
      className={`w-full sm:min-w-[300px] sm:w-[300px] flex flex-col h-fit max-h-full bg-white rounded-xl border border-[#e9e9e8] transition-all flex-shrink-0 ${isDragging ? 'opacity-0' : ''}`}
    >
      {/* Column Header - Drag Handle */}
      <div
        className={`flex items-center justify-between px-4 py-3 pt-4 flex-shrink-0 ${isMobile ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
        {...attributes}
        {...listeners}
      >
        {editingListId === list.id ? (
          <input
            autoFocus
            value={editingListTitle}
            onChange={(e) => setEditingListTitle(e.target.value)}
            onBlur={saveListTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveListTitle();
              if (e.key === 'Escape') setEditingListId(null);
            }}
            className="font-medium text-lg text-[#1f1f1f] bg-transparent border-b-2 border-[var(--color-primary)] focus:outline-none w-full"
            onPointerDown={e => e.stopPropagation()}
          />
        ) : (
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              {listTab && (
                <div
                  className="todo-tab-dot w-2 h-2 rounded-full flex-shrink-0"
                  style={{
                    '--todo-tab-color': listTab.color,
                    '--todo-tab-dark-color': getDarkAdaptiveColor(listTab.color),
                  } as React.CSSProperties}
                />
              )}
              <h3
                className="font-medium text-lg text-[#1f1f1f] cursor-text"
                onClick={(e) => {
                  e.stopPropagation();
                  startEditingList(list);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                title="클릭하여 제목 수정"
              >
                {list.title}
              </h3>
            </div>
            {list.dueDate && (
              <div className="text-[11.5px] text-[#2c7a7b] bg-[#e6fffa] px-1.5 py-0.5 rounded border border-[#b2f5ea] mt-1 font-medium w-fit flex items-center gap-1">
                <CalendarIcon size={10} />
                마감: {formatShortDate(list.dueDate) || '-'}
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-1">

          <button
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#f5f5f5] text-[#5f6368]"
            onPointerDown={e => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setListMenu({ id: list.id, x: e.clientX, y: e.clientY });
            }}
          >
            <MoreVertical size={18} />
          </button>
        </div>
      </div>

      <div className="mx-4 border-t border-[#e9e9e8]" />

      {/* Sortable List Area */}
      <div className="flex-1 overflow-y-auto px-2 pt-1 pb-4 min-h-[100px]" ref={setDroppableListRef}>
        {/* Helper to render todo items (only takes space if items exist) */}
        <DroppableSection stepId={null} sectionTodos={listTodos.filter(t => !t.completed && !t.stepId)} {...commonSectionProps} />

        {/* Render Steps */}
        {listSteps.map((step: TodoStep) => {
          const stepTodos = todos.filter(t => t.stepId === step.id && t.listId === list.id);
          const aggregateTotal = stepTodos.reduce((sum, t) => sum + (t.subTasks?.length || 0), 0);
          const aggregateCompleted = stepTodos.reduce((sum, t) => sum + (t.subTasks?.filter(s => s.completed).length || 0), 0);

          return (
            <div key={step.id} className="mt-4 mb-2">
              <div className="px-2 py-1 flex items-center justify-between group/step">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {editingStepId === step.id ? (
                    <input
                      autoFocus
                      className="text-[12px] font-medium text-[var(--color-primary)] uppercase tracking-wider bg-transparent border-b border-[#9bbcf3] focus:outline-none w-full"
                      value={editingStepTitle}
                      onChange={(e) => setEditingStepTitle(e.target.value)}
                      onBlur={() => {
                        if (editingStepTitle.trim()) onUpdateStep(step.id, { title: editingStepTitle.trim() });
                        setEditingStepId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (editingStepTitle.trim()) onUpdateStep(step.id, { title: editingStepTitle.trim() });
                          setEditingStepId(null);
                        }
                      }}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[12px] font-medium text-[#5f6368] uppercase tracking-wider cursor-pointer hover:text-[var(--color-primary)]"
                        onClick={() => {
                          setEditingStepId(step.id);
                          setEditingStepTitle(step.title);
                        }}
                      >
                        {step.title}
                      </span>
                      {aggregateTotal > 0 && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${aggregateCompleted === aggregateTotal ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'}`}>
                          {aggregateCompleted}/{aggregateTotal} 완료
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center opacity-0 group-hover/step:opacity-100 transition-opacity">
                    <button
                      onClick={() => setDraft({ text: ' ', stepId: step.id })}
                      className="p-1 hover:bg-blue-50 text-blue-500 rounded transition-colors mr-0.5"
                      title="이 단계에 할 일 추가"
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      onClick={() => onDeleteStep(step.id)}
                      className="p-1 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded transition-colors"
                      title="단계 삭제"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
              <DroppableSection stepId={step.id} sectionTodos={listTodos.filter(t => !t.completed && t.stepId === step.id)} {...commonSectionProps} />
            </div>
          );
        })}

        {/* Global Add Todo (No Step) */}
        {!draft.stepId && draft.text === '' && (
          <div className="flex flex-col gap-1 mt-2">
            <button
              onClick={() => setDraft({ text: ' ', stepId: null })}
              className="w-full text-left px-2 py-2 text-[13px] text-[var(--color-primary)] font-medium rounded-lg hover:bg-[#ebf5fc] transition-colors flex items-center gap-2"
            >
              <Plus size={18} />
              할 일 추가
            </button>
            <button
              onClick={() => onAddStep('새 단계', list.id)}
              className="w-full text-left px-2 py-1.5 text-[11px] text-[#5f6368] font-medium uppercase tracking-tight rounded hover:bg-gray-100 transition-colors flex items-center gap-2 ml-1"
            >
              <Layout size={14} />
              단계 추가
            </button>
          </div>
        )}

        {/* Completed Section */}
        {listTodos.filter(t => t.completed).length > 0 && (
          <div className="mt-6 pt-2 border-t border-gray-100">
            <button
              onClick={() => setShowCompleted(!showCompleted)}
              className="flex items-center gap-2 text-sm font-medium text-[#5f6368] hover:bg-[#f5f5f5] px-2 py-1.5 rounded transition-colors w-full mb-1"
            >
              <ChevronRight
                size={16}
                className={`transition-transform duration-200 ${showCompleted ? 'rotate-90' : ''}`}
              />
              <span>완료됨 ({listTodos.filter(t => t.completed).length})</span>
            </button>

            {showCompleted && (
              <div className="space-y-0.5">
                {listTodos.filter(t => t.completed).map((todo: Todo) => (
                  <div key={todo.id} className="group flex items-start gap-3 px-3 py-2.5 rounded hover:bg-[#f5f5f5]">
                    <button
                      type="button"
                      aria-label="완료 취소"
                      className="w-4 h-4 mt-0.5 rounded-full bg-[var(--color-primary)] border border-[var(--color-primary)] flex-shrink-0 flex items-center justify-center cursor-pointer"
                      onClick={() => onToggleTodo(todo.id)}
                    >
                      <Check size={10} className="text-white stroke-[3px]" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className="text-[14px] text-[#5f6368] line-through block decoration-[#5f6368]">{todo.text}</span>
                      {todo.subTasks && todo.subTasks.length > 0 && (
                        <div className="mt-1 space-y-1">
                          {todo.subTasks.map((st: any) => (
                            <div key={st.id} className="flex items-start gap-1.5 opacity-60">
                              <div className="mt-[2px]">
                                {st.completed ? (
                                  <div className="w-3 h-3 rounded bg-gray-400 flex items-center justify-center">
                                    <Check size={8} className="text-white stroke-[3px]" />
                                  </div>
                                ) : (
                                  <div className="todo-subtask-check is-unchecked w-3 h-3 rounded border border-gray-400 bg-transparent" />
                                )}
                              </div>
                              <span className={`text-[11.5px] leading-snug ${st.completed ? 'text-gray-400 line-through' : 'text-gray-500'}`}>
                                {st.text}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-[#5f6368] hover:text-[#d93025] p-1"
                      onClick={() => onDeleteTodo(todo.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const TodoView: React.FC<TodoViewProps> = ({
  todos,
  lists,
  tabs,
  onAddList,
  onUpdateList,
  onUpdateListOrder,
  onAddTodo,
  onUpdateTodo,
  onToggleTodo,
  onDeleteTodo,
  onDeleteList,
  onAddTab,
  onUpdateTab,
  onDeleteTab,
  steps,
  onAddStep,
  onUpdateStep,
  onDeleteStep,
  sidebarSlot
}) => {
  const hasSidebarSlot = Boolean(sidebarSlot);
  const [filterMode, setFilterMode] = useState<string>('all');
  const [listSettingsModal, setListSettingsModal] = useState<string | null>(null);
  const [newListTabId, setNewListTabId] = useState<string | null>(null);
  const [tabSettingsModal, setTabSettingsModal] = useState<string | null>(null);
  const [newTabModal, setNewTabModal] = useState(false);

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const sortedTabs = [...tabs].sort((a, b) => a.order - b.order);
  const tabIdSet = new Set(tabs.map(tab => tab.id));
  const isUnassignedList = (list: TodoList) => !list.tabId || !tabIdSet.has(list.tabId);
  const unassignedListCount = lists.filter(isUnassignedList).length;
  const matchesFilter = (list: TodoList) => {
    if (filterMode === 'all') return true;
    if (filterMode === UNASSIGNED_TAB_FILTER) return isUnassignedList(list);
    return list.tabId === filterMode;
  };

  useEffect(() => {
    // Fall back to "all" when the selected tab disappears (deleted, or no unassigned lists left).
    if (filterMode === 'all') return;
    if (filterMode === UNASSIGNED_TAB_FILTER ? unassignedListCount === 0 : !tabIdSet.has(filterMode)) {
      setFilterMode('all');
    }
  }, [filterMode, unassignedListCount, tabs]);

  const filteredTodos = todos.filter(t => {
    if (filterMode === 'all') return true;
    const list = lists.find(l => l.id === t.listId);
    if (!list) return false;
    return matchesFilter(list);
  });

  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editingListTitle, setEditingListTitle] = useState('');

  // Editing state for todo text
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editingTodoText, setEditingTodoText] = useState('');

  // Context Menu & Modal State
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number; expanded?: boolean } | null>(null);
  const [listMenu, setListMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const listMenuRef = useRef<HTMLDivElement>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<'List' | 'Todo' | null>(null);

  const sortedLists = [...lists]
    .filter(matchesFilter)
    .sort((a, b) => a.order - b.order);

  // Infinite Canvas State
  const containerRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [masonryColumnCount, setMasonryColumnCount] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });
  const [scrollStart, setScrollStart] = useState({ left: 0, top: 0 });

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    const updateColumnCount = (width: number) => {
      const cardWidth = 300;
      const gap = 24;
      const nextCount = isMobile
        ? 1
        : Math.max(1, Math.min(4, Math.floor((width + gap) / (cardWidth + gap))));
      setMasonryColumnCount(prev => (prev === nextCount ? prev : nextCount));
    };

    updateColumnCount(board.clientWidth);

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) updateColumnCount(entry.contentRect.width);
    });
    observer.observe(board);

    return () => observer.disconnect();
  }, [isMobile]);

  // Group cards under the tab they belong to; lists whose tab no longer exists go to "미분류".
  const boardSections = [
    ...sortedTabs.map(tab => ({
      id: tab.id,
      tab: tab as TodoTab | null,
      title: tab.name,
      lists: sortedLists.filter(list => list.tabId === tab.id),
    })),
    {
      id: UNASSIGNED_TAB_FILTER,
      tab: null as TodoTab | null,
      title: UNASSIGNED_TAB_LABEL,
      lists: sortedLists.filter(isUnassignedList),
    },
  ].filter(section => (
    filterMode === 'all'
      ? section.tab !== null || section.lists.length > 0
      : section.id === filterMode
  ));

  // Distribute cards (plus the trailing "add list" tile) across masonry columns.
  const toMasonryColumns = (sectionLists: TodoList[], includeAddTile: boolean) => {
    const items: (TodoList | typeof ADD_LIST_TILE)[] = includeAddTile ? [...sectionLists, ADD_LIST_TILE] : sectionLists;
    const columnCount = Math.max(1, Math.min(masonryColumnCount, items.length));
    const columns: (TodoList | typeof ADD_LIST_TILE)[][] = Array.from({ length: columnCount }, () => []);
    items.forEach((item, index) => {
      columns[index % columnCount].push(item);
    });
    return columns;
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Close context menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
      if (listMenuRef.current && !listMenuRef.current.contains(event.target as Node)) {
        setListMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Background Panning Logic
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only pan if clicking on the background container itself
    if (e.target === containerRef.current) {
      setIsPanning(true);
      setStartPan({ x: e.clientX, y: e.clientY });
      if (containerRef.current) {
        setScrollStart({
          left: containerRef.current.scrollLeft,
          top: containerRef.current.scrollTop
        });
      }
      document.body.style.cursor = 'grabbing';
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning || !containerRef.current) return;
    const dx = e.clientX - startPan.x;
    const dy = e.clientY - startPan.y;
    containerRef.current.scrollLeft = scrollStart.left - dx;
    containerRef.current.scrollTop = scrollStart.top - dy;
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    document.body.style.cursor = '';
  };

  const startEditingList = (list: TodoList) => {
    setEditingListId(list.id);
    setEditingListTitle(list.title);
  };

  const saveListTitle = () => {
    if (editingListId && editingListTitle.trim()) {
      onUpdateList(editingListId, { title: editingListTitle.trim() });
    }
    setEditingListId(null);
    setEditingListTitle('');
  };

  const startEditingTodo = (todo: Todo) => {
    setEditingTodoId(todo.id);
    setEditingTodoText(todo.text);
    setContextMenu(null);
  };

  const saveTodoText = () => {
    if (editingTodoId && onUpdateTodo) {
      if (editingTodoText.trim()) {
        onUpdateTodo(editingTodoId, { text: editingTodoText.trim() });
      }
    }
    setEditingTodoId(null);
    setEditingTodoText('');
  };

  const handleMoveTodo = (todoId: string, newListId: string) => {
    if (onUpdateTodo) {
      onUpdateTodo(todoId, { listId: newListId });
    }
    setContextMenu(null);
  };

  const getDueLabel = (dueDate?: string) => {
    if (!dueDate) return null;
    const d = parseISO(dueDate);
    if (!isValid(d)) return null;
    if (isToday(d)) return '오늘';
    if (isTomorrow(d)) return '내일';
    try {
      return format(d, 'M월 d일 (E)', { locale: ko });
    } catch {
      return null;
    }
  };

  // DnD Handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    setActiveType(event.active.data.current?.type || null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    // We only care about drag over if we are dragging a TODO
    if (active.data.current?.type !== 'Todo') return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeTodo = todos.find(t => t.id === activeId);
    const overTodo = todos.find(t => t.id === overId);

    if (!activeTodo) return;

    // Case 1: Over a list container directly (e.g. empty list or header)
    if (lists.some(l => l.id === overId)) {
      if (activeTodo.listId !== overId) {
        // Optimistic update logic could go here if using local state for todos
      }
      return;
    }

    // Case 2: Over another todo
    if (overTodo && activeTodo.listId !== overTodo.listId) {
      // Different list - dragging todo to another list's todo
      // Handled in DragEnd usually for DB sync, or here for UI optimistic update
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const activeTodo = todos.find(t => t.id === (active.id as string));
    if (!activeTodo) {
      // If it's not a todo, handle list reordering normally
      setActiveId(null);
      setActiveType(null);
      if (!over) return;
      const activeId = active.id as string;
      const overId = over.id as string;

      if (active.data.current?.type === 'List' && over.data.current?.type === 'List') {
        if (activeId !== overId) {
          const oldIndex = lists.findIndex(l => l.id === activeId);
          const newIndex = lists.findIndex(l => l.id === overId);
          const newLists = arrayMove<TodoList>(lists, oldIndex, newIndex);
          const updatedLists = newLists.map((list, index) => ({ ...list, order: index }));
          if (onUpdateListOrder) onUpdateListOrder(updatedLists);
        }
      }
      return;
    }

    setActiveId(null);
    setActiveType(null);
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;

    // Dropped onto a step or empty list area
    const overData = over.data.current;
    if (overData && (overData.type === 'Step' || overData.type === 'ListGeneral' || overData.type === 'List')) {
      const targetListId = overData.listId || (overData.list ? overData.list.id : overId);
      const targetStepId = overData.stepId || undefined;

      if ((activeTodo.listId !== targetListId || activeTodo.stepId !== targetStepId) && onUpdateTodo) {
        onUpdateTodo(activeId, { listId: targetListId, stepId: targetStepId });
      }
      return;
    }

    // Dropped onto another todo
    const overTodo = todos.find(t => t.id === overId);
    if (overTodo && onUpdateTodo) {
      if ((activeTodo.listId !== overTodo.listId || activeTodo.stepId !== overTodo.stepId) && onUpdateTodo) {
        onUpdateTodo(activeId, { listId: overTodo.listId, stepId: overTodo.stepId });
      }
    }
  };

  const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: '0.5',
        },
      },
    }),
  };

  const renderFilterRow = (
    key: string,
    label: string,
    count: number,
    options: { tab?: TodoTab; muted?: boolean } = {}
  ) => {
    const isActive = filterMode === key;
    const { tab, muted } = options;

    return (
      <div key={key} className="group relative">
        <button
          type="button"
          onClick={() => setFilterMode(key)}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-[15px] leading-5 ${isActive ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)] font-medium' : 'font-normal text-[#5f5f5f] hover:bg-[#f7f7f7] hover:text-[#171717]'}`}
          style={tab ? {
            '--todo-tab-color': tab.color,
            '--todo-tab-dark-color': getDarkAdaptiveColor(tab.color),
          } as React.CSSProperties : undefined}
        >
          {tab && <span className="todo-tab-dot h-2 w-2 shrink-0 rounded-full" />}
          {muted && <span className="h-2 w-2 shrink-0 rounded-full border border-[#b5b5b5]" />}
          <span className="flex-1 truncate text-left">{label}</span>
          <span className={`text-[13px] leading-5 ${tab ? 'transition-opacity group-hover:opacity-0' : ''} ${isActive ? 'font-medium text-[var(--color-primary)]' : 'font-normal text-[#8a8a8a]'}`}>{count}</span>
        </button>
        {tab && (
          <button
            type="button"
            onClick={() => setTabSettingsModal(tab.id)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[#8a8a8a] opacity-0 transition-all hover:bg-[#eeeeee] hover:text-[#171717] group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={`${tab.name} 탭 편집`}
            title="탭 편집"
          >
            <Edit3 size={13} />
          </button>
        )}
      </div>
    );
  };

  const sidebarContent = (
    <>
      <button
        type="button"
        onClick={() => setNewTabModal(true)}
        className="w-full flex items-center gap-2.5 rounded-lg bg-[#f7f7f7] px-3 py-2.5 text-[15px] leading-5 font-medium text-[#37352f] transition-colors hover:bg-[#eeeeee]"
      >
        <Plus size={18} className="shrink-0" />
        <span>새 탭</span>
      </button>

      <div className="mt-6 mb-1 px-3">
        <span className="text-[13px] leading-5 font-normal text-[#8a8a8a]">탭</span>
      </div>
      <div className="space-y-0.5">
        {renderFilterRow('all', '모두 보기', lists.length)}
        {sortedTabs.map(tab => renderFilterRow(tab.id, tab.name, lists.filter(list => list.tabId === tab.id).length, { tab }))}
        {unassignedListCount > 0 && renderFilterRow(UNASSIGNED_TAB_FILTER, UNASSIGNED_TAB_LABEL, unassignedListCount, { muted: true })}
      </div>
    </>
  );

  const renderListCard = (list: TodoList) => (
    <SortableList
      key={list.id}
      list={list}
      lists={lists}
      todos={filteredTodos}
      editingListId={editingListId}
      editingListTitle={editingListTitle}
      setEditingListTitle={setEditingListTitle}
      saveListTitle={saveListTitle}
      setEditingListId={setEditingListId}
      startEditingList={startEditingList}
      handleMoveTodo={handleMoveTodo}
      onAddTodo={onAddTodo}
      onUpdateTodo={onUpdateTodo}
      onToggleTodo={onToggleTodo}
      onDeleteTodo={onDeleteTodo}
      editingTodoId={editingTodoId}
      editingTodoText={editingTodoText}
      setEditingTodoText={setEditingTodoText}
      setEditingTodoId={setEditingTodoId}
      startEditingTodo={startEditingTodo}
      saveTodoText={saveTodoText}
      setContextMenu={setContextMenu}
      setListMenu={setListMenu}
      getDueLabel={getDueLabel}
      tabs={tabs}
      steps={steps}
      onAddStep={onAddStep}
      onUpdateStep={onUpdateStep}
      onDeleteStep={onDeleteStep}
      isMobile={isMobile}
    />
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div
        ref={containerRef}
        className="flex flex-col h-full bg-white font-sans overflow-y-auto overflow-x-hidden select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: isPanning ? 'grabbing' : 'auto' }}
      >
        {sidebarSlot && createPortal(sidebarContent, sidebarSlot)}
        <div className={`hidden min-h-16 sm:flex ${hasSidebarSlot ? 'lg:hidden' : ''} px-4 sm:px-8 border-b border-gray-100 items-center`}>
          <h1 className="text-lg font-medium text-[#37352f]">할 일</h1>
        </div>

        <div className={`px-4 pt-7 pb-5 sm:px-8 ${hasSidebarSlot ? 'lg:hidden' : ''}`}>
          <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar scroll-smooth">
            <button
              onClick={() => setFilterMode('all')}
              className={`inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-medium whitespace-nowrap transition-colors ${filterMode === 'all'
                ? 'bg-[var(--color-primary)] text-white border-transparent'
                : 'bg-[#f7f7f7] text-[#5f5f5f] border-transparent hover:bg-[#eeeeee] hover:text-[#171717]'
                }`}
            >
              모두 보기
            </button>

            {sortedTabs.map(tab => (
              <div key={tab.id} className="relative group flex-shrink-0">
                <button
                  onClick={() => setFilterMode(tab.id)}
                  className={`todo-filter-tab inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-medium whitespace-nowrap transition-colors ${filterMode === tab.id
                    ? 'is-active'
                    : 'bg-[#f7f7f7] text-[#5f5f5f] border-transparent hover:bg-[#eeeeee] hover:text-[#171717]'
                    }`}
                  style={{
                    '--todo-tab-color': tab.color,
                    '--todo-tab-dark-color': getDarkAdaptiveColor(tab.color),
                  } as React.CSSProperties}
                >
                  {tab.name}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setTabSettingsModal(tab.id); }}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-white border border-gray-200 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Edit3 size={10} className="text-gray-400" />
                </button>
              </div>
            ))}

            {unassignedListCount > 0 && (
              <button
                onClick={() => setFilterMode(UNASSIGNED_TAB_FILTER)}
                className={`inline-flex h-10 flex-shrink-0 items-center justify-center rounded-lg border px-4 text-sm font-medium whitespace-nowrap transition-colors ${filterMode === UNASSIGNED_TAB_FILTER
                  ? 'bg-[var(--color-primary)] text-white border-transparent'
                  : 'bg-[#f7f7f7] text-[#5f5f5f] border-transparent hover:bg-[#eeeeee] hover:text-[#171717]'
                  }`}
              >
                {UNASSIGNED_TAB_LABEL}
              </button>
            )}

            <button
              onClick={() => setNewTabModal(true)}
              className="h-10 w-10 rounded-lg bg-[#f7f7f7] flex items-center justify-center text-[#8a8a8a] hover:bg-[#eeeeee] hover:text-[#171717] transition-colors flex-shrink-0"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* Infinite Canvas Content Area */}
        <div className={`flex-1 pt-1 pb-8 px-4 sm:px-8 min-w-fit min-h-fit ${hasSidebarSlot ? 'lg:pt-8' : ''}`}>
          <SortableContext
            items={sortedLists.map(l => l.id)}
            strategy={rectSortingStrategy}
          >
            <div ref={boardRef} className="flex flex-col gap-10">
              {boardSections.map(section => (
                <section key={section.id}>
                  <div className="mb-4 flex items-center gap-2">
                    {section.tab ? (
                      <span
                        className="todo-tab-dot h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          '--todo-tab-color': section.tab.color,
                          '--todo-tab-dark-color': getDarkAdaptiveColor(section.tab.color),
                        } as React.CSSProperties}
                      />
                    ) : (
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-[#b5b5b5]" />
                    )}
                    <h2 className="text-[16px] leading-6 font-medium text-[#37352f]">{section.title}</h2>
                    <span className="text-[13px] leading-5 font-normal text-[#8a8a8a]">{section.lists.length}</span>
                  </div>

                  <div className="flex flex-col items-start gap-4 sm:flex-row sm:gap-6">
                    {toMasonryColumns(section.lists, Boolean(section.tab)).map((column, columnIndex) => (
                      <div key={columnIndex} className="flex w-full flex-col gap-4 sm:w-[300px] sm:shrink-0 sm:gap-6">
                        {column.map(item => (
                          item === ADD_LIST_TILE ? (
                            <button
                              key={ADD_LIST_TILE}
                              type="button"
                              onClick={() => setNewListTabId(section.id)}
                              className="flex h-12 w-full items-center gap-2.5 rounded-xl bg-[#f7f7f7] px-4 text-[15px] leading-5 font-medium text-[#37352f] transition-colors hover:bg-[#eeeeee]"
                            >
                              <Plus size={18} className="shrink-0" />
                              <span className="truncate">{section.title}에 목록 추가</span>
                            </button>
                          ) : renderListCard(item)
                        ))}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </SortableContext>
        </div>

        {/* Drag Overlay */}
        <DragOverlay dropAnimation={dropAnimation}>
          {activeId ? (
            activeType === 'List' ? (
              <div className="w-[calc(100vw-32px)] sm:w-[300px] h-[400px] bg-white rounded-xl border border-[#9bbcf3] opacity-90 cursor-grabbing p-4">
                <div className="font-medium text-lg text-[#1f1f1f]">{lists.find(l => l.id === activeId)?.title}</div>
              </div>
            ) : (
              <div className="bg-white rounded-lg border border-[#9bbcf3] p-3 flex items-center gap-3 opacity-90 cursor-grabbing ring-1 ring-[#dce8fd] z-50">
                {(() => {
                  const todo = todos.find(t => t.id === activeId);
                  if (!todo) return null;
                  return (
                    <>
                      <Checkbox checked={todo.completed} onClick={() => { }} />
                      <span className="text-[14px] text-[#1f1f1f]">{todo.text}</span>
                    </>
                  )
                })()}
              </div>
            )
          ) : null}
        </DragOverlay>

        {contextMenu && contextMenu.expanded && (
          <ExpandedTodoModal
            todoId={contextMenu.id}
            todos={todos}
            lists={lists}
            onClose={() => setContextMenu(null)}
            onUpdateTodo={onUpdateTodo}
          />
        )}
        {contextMenu && !contextMenu.expanded && (
          <div
            ref={contextMenuRef}
            className="fixed bg-white rounded-lg border border-[#e9e9e8] py-1 z-50 w-48 animate-in fade-in zoom-in-95 duration-100"
            style={{ top: contextMenu.y, left: contextMenu.x - 180 }}
          >
            <div className="px-3 py-2 border-b border-[#f0f0ef] text-xs font-medium text-[#9b9a97]">
              작업 이동
            </div>
            {lists.map(list => (
              <button
                key={list.id}
                className="w-full text-left px-3 py-2 text-sm text-[#37352f] hover:bg-[#f7f7f5] flex items-center gap-2"
                onClick={() => handleMoveTodo(contextMenu.id, list.id)}
              >
                {list.title}
              </button>
            ))}
            <div className="my-1 border-t border-[#f0f0ef]" />
            <button
              className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
              onClick={() => {
                onDeleteTodo(contextMenu.id);
                setContextMenu(null);
              }}
            >
              <Trash2 size={14} />
              <span>삭제</span>
            </button>
          </div>
        )}
        {listMenu && (
          <div
            ref={listMenuRef}
            className="fixed bg-white rounded-lg border border-[#e9e9e8] py-1 z-50 w-40 animate-in fade-in zoom-in-95 duration-100"
            style={{ top: listMenu.y, left: listMenu.x - 140 }}
          >
            <div className="px-3 py-2 border-b border-[#f0f0ef] text-xs font-medium text-[#9b9a97]">
              목록 관리
            </div>

            <button
              className="w-full text-left px-3 py-2 text-sm text-[#37352f] hover:bg-[#f7f7f5] flex items-center gap-2"
              onClick={() => {
                setListSettingsModal(listMenu.id);
                setListMenu(null);
              }}
            >
              <CalendarIcon size={14} />
              <span>설정 및 기간</span>
            </button>
            <div className="my-1 border-t border-[#f0f0ef]" />
            <button
              className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
              onClick={() => {
                onDeleteList(listMenu.id);
                setListMenu(null);
              }}
            >
              <Trash2 size={14} />
              <span>목록 삭제</span>
            </button>
          </div>
        )}
        {listSettingsModal && (
          <ListSettingsModal
            listId={listSettingsModal}
            lists={lists}
            tabs={tabs}
            onClose={() => setListSettingsModal(null)}
            onUpdateList={onUpdateList}
          />
        )}
        {newListTabId !== null && (
          <ListSettingsModal
            defaultTabId={newListTabId}
            lists={lists}
            tabs={tabs}
            onClose={() => setNewListTabId(null)}
            onAddList={onAddList}
          />
        )}
        {(tabSettingsModal || newTabModal) && (
          <TabSettingsModal
            tabId={tabSettingsModal}
            tabs={tabs}
            onClose={() => { setTabSettingsModal(null); setNewTabModal(false); }}
            onAddTab={onAddTab}
            onUpdateTab={onUpdateTab}
            onDeleteTab={onDeleteTab}
          />
        )}
      </div>
    </DndContext>
  );
};

export default TodoView;
