import React, { useState, useRef, useEffect } from 'react';
import { Todo, TodoList, TodoTab, TodoStep } from '../types';
import { Check, ChevronRight, MoreVertical, CalendarIcon, Trash2, Plus, GripVertical, AlertCircle, X, Maximize2, CheckSquare, Layout, Edit3 } from '../components/Icons';
import { format, isToday, isTomorrow, parseISO } from 'date-fns';
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
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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
}



// Checkbox Component
const Checkbox = ({ checked, onClick }: { checked: boolean; onClick: (e: React.MouseEvent) => void }) => (
  <button
    type="button"
    aria-pressed={checked}
    className={`w-4 h-4 mt-0.5 rounded-full border flex-shrink-0 cursor-pointer transition-all flex items-center justify-center
      ${checked
        ? 'bg-[#1a73e8] border-[#1a73e8]'
        : 'border-[#5f6368] hover:bg-[#e8eaed]'
      }`}
    onClick={onClick}
  >
    {checked && <Check size={10} className="text-white stroke-[3px]" />}
  </button>
);

// --- List Settings Modal (Date & Tab) ---
const ListSettingsModal = ({ listId, lists, tabs, onClose, onUpdateList, onAddList }: any) => {
  const isEditing = !!listId;
  const list = isEditing ? lists.find((l: TodoList) => l.id === listId) : null;

  const [title, setTitle] = useState(list?.title || '');
  const [dueDate, setDueDate] = useState(list?.dueDate || '');
  const [tabId, setTabId] = useState<string>(list?.tabId || tabs[0]?.id || '');

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
    <div className="fixed inset-0 bg-black/30 z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <h2 className="text-lg font-semibold text-gray-800">
            {isEditing ? '목록 설정' : '새 목록 만들기'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-6">
          {!isEditing && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5 capital">목록 제목</label>
              <input
                autoFocus
                type="text"
                placeholder="제목을 입력하세요"
                className="w-full text-sm border-none bg-gray-50 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">탭(분류) 선택</label>
            <div className="grid grid-cols-2 gap-2 max-h-[160px] overflow-y-auto pr-1">
              {tabs.map((tab: TodoTab) => (
                <button
                  key={tab.id}
                  onClick={() => setTabId(tab.id)}
                  className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2 border-2 ${tabId === tab.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-transparent bg-gray-50 hover:bg-gray-100'
                    }`}
                >
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tab.color }} />
                  <span className="truncate">{tab.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">마감 일자 (선택)</label>
            <input
              type="date"
              className="w-full text-sm border-none bg-gray-50 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-blue-500 transition-all"
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
            className="px-6 py-2 text-sm font-medium text-white bg-[#1a73e8] hover:bg-blue-700 rounded-lg shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
  const [color, setColor] = useState(tab?.color || '#1a73e8');

  const COLORS = ['#1a73e8', '#d93025', '#188038', '#f29900', '#9c27b0', '#0097a7', '#5f6368', '#ff4081'];

  const handleSave = () => {
    if (isEditing) {
      onUpdateTab(tabId, { name: name.trim(), color });
    } else {
      onAddTab(name.trim() || "새 탭", color);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">
            {isEditing ? '탭 수정' : '새 탭 만들기'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5 capital">탭 이름</label>
            <input
              autoFocus
              type="text"
              placeholder="이름을 입력하세요"
              className="w-full text-sm border-none bg-gray-50 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">테마 색상</label>
            <div className="flex flex-wrap gap-3">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-offset-2 ring-gray-400' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                />
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
              className="px-6 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-md transition-all disabled:opacity-50"
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
    <div className="fixed inset-0 bg-black/30 z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">상세 편집</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">할 일 내용</label>
            <textarea
              className="w-full text-sm text-gray-800 border-none bg-gray-50 rounded-lg px-3 py-2.5 resize-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors"
              rows={3}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="무엇을 해야 하나요?"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5 flex items-center justify-between">
              <span>마감 일자</span>
              {maxDueDate && (
                <span className="text-[10px] font-normal text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded">
                  목록 제약: ~ {maxDueDate}
                </span>
              )}
            </label>
            <input
              type="date"
              className="w-full text-sm border-none bg-gray-50 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-blue-500 transition-colors"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              max={maxDueDate || undefined}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5 flex items-center justify-between">
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
                    className={`flex-1 text-sm bg-transparent border-transparent focus:border-blue-500 focus:ring-0 px-1 py-1 rounded transition-colors ${st.completed ? 'text-gray-400 line-through' : 'text-gray-700'}`}
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
                className="flex-1 text-sm bg-gray-50 border-none rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
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
          <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors">
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
    disabled: isEditing,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    touchAction: 'none',
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
      className={`group relative px-3 py-2.5 rounded-lg hover:bg-[#f5f5f5] hover:shadow-sm transition-all flex items-start gap-3 cursor-pointer ${isEditing ? 'bg-white shadow ring-2 ring-[#1a73e8] z-10' : ''}`}
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
            className="w-full text-[14px] text-[#1f1f1f] bg-transparent border-b border-[#1a73e8] focus:outline-none"
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
            <span className={`block text-[11px] px-1.5 py-0.5 rounded font-medium ${completedSubTasks === totalSubTasks ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
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
                    <div className="w-3.5 h-3.5 rounded bg-blue-500 border border-blue-500 flex items-center justify-center">
                      <Check size={10} className="text-white stroke-[3px]" />
                    </div>
                  ) : (
                    <div className="w-3.5 h-3.5 rounded border border-gray-400 group-hover/subtask:border-blue-500 bg-white transition-colors" />
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
          />
        ))}
      </SortableContext>

      {draft.stepId === stepId && draft.text !== '' && (
        <div className="mt-1 mx-1 mb-2 bg-white rounded-lg shadow-sm border border-gray-200">
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
}: any) => {
  const { isOver, setNodeRef } = useDroppable({
    id: stepId || `list-${listId}-general`,
    data: {
      type: stepId ? 'Step' : 'ListGeneral',
      stepId,
      listId
    }
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
    disabled: editingListId === list.id,
  });

  const { isOver: isOverList, setNodeRef: setDroppableListRef } = useDroppable({
    id: `list-${list.id}-droppable`,
    data: {
      type: 'List',
      listId: list.id,
    }
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    touchAction: 'none',
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
      className={`w-full sm:min-w-[300px] sm:w-[300px] flex flex-col h-fit max-h-full bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.08)] border border-[#e9e9e8] transition-all flex-shrink-0 ${isDragging ? 'opacity-0' : ''}`}
    >
      {/* Column Header - Drag Handle */}
      <div
        className="flex items-center justify-between px-4 py-3 pt-4 flex-shrink-0 cursor-grab active:cursor-grabbing"
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
            className="font-medium text-lg text-[#1f1f1f] bg-transparent border-b-2 border-[#1a73e8] focus:outline-none w-full"
            onPointerDown={e => e.stopPropagation()}
          />
        ) : (
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              {listTab && (
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: listTab.color }}
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
                마감: {format(parseISO(list.dueDate), 'M.d')}
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
                      className="text-[12px] font-bold text-[#1a73e8] uppercase tracking-wider bg-transparent border-b border-[#1a73e8] focus:outline-none w-full"
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
                        className="text-[12px] font-bold text-[#5f6368] uppercase tracking-wider cursor-pointer hover:text-[#1a73e8]"
                        onClick={() => {
                          setEditingStepId(step.id);
                          setEditingStepTitle(step.title);
                        }}
                      >
                        {step.title}
                      </span>
                      {aggregateTotal > 0 && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${aggregateCompleted === aggregateTotal ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {aggregateCompleted}/{aggregateTotal} 완료
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center opacity-0 group-hover/step:opacity-100 transition-opacity">
                    <button
                      onClick={() => onDeleteStep(step.id)}
                      className="p-1 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded transition-colors"
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
        {!draft.stepId && draft.text === '' ? (
          <div className="flex flex-col gap-1 mt-2">
            <button
              onClick={() => setDraft({ text: ' ', stepId: null })}
              className="w-full text-left px-2 py-2 text-[13px] text-[#1a73e8] font-medium rounded-lg hover:bg-[#ebf5fc] transition-colors flex items-center gap-2"
            >
              <Plus size={18} />
              할 일 추가
            </button>
            <button
              onClick={() => onAddStep('새 단계', list.id)}
              className="w-full text-left px-2 py-1.5 text-[11px] text-[#5f6368] font-semibold uppercase tracking-tight rounded hover:bg-gray-100 transition-colors flex items-center gap-2 ml-1"
            >
              <Layout size={14} />
              단계 추가
            </button>
          </div>
        ) : !draft.stepId && (
          <div className="mt-2 mx-1 mb-2 bg-white rounded-lg shadow-sm border border-gray-200">
            <input
              autoFocus
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd(null);
                if (e.key === 'Escape') setDraft({ text: '', stepId: null });
              }}
              placeholder="할 일 추가"
              className="w-full px-3 py-3 text-sm focus:outline-none bg-transparent"
              onPointerDown={e => e.stopPropagation()}
            />
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
                      className="w-4 h-4 mt-0.5 rounded-full bg-[#1a73e8] border border-[#1a73e8] flex-shrink-0 flex items-center justify-center cursor-pointer"
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
                                  <div className="w-3 h-3 rounded border border-gray-400 bg-transparent" />
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
  onDeleteStep
}) => {
  const [filterMode, setFilterMode] = useState<string>('all');
  const [listSettingsModal, setListSettingsModal] = useState<string | null>(null);
  const [newListModal, setNewListModal] = useState(false);
  const [tabSettingsModal, setTabSettingsModal] = useState<string | null>(null);
  const [newTabModal, setNewTabModal] = useState(false);

  const filteredTodos = todos.filter(t => {
    if (filterMode === 'all') return true;
    const list = lists.find(l => l.id === t.listId);
    if (!list) return false;
    return list.tabId === filterMode;
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
    .filter(l => filterMode === 'all' || l.tabId === filterMode)
    .sort((a, b) => a.order - b.order);

  // Infinite Canvas State
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });
  const [scrollStart, setScrollStart] = useState({ left: 0, top: 0 });

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
    if (isToday(d)) return '오늘';
    if (isTomorrow(d)) return '내일';
    return format(d, 'M월 d일 (E)', { locale: ko });
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
        <div className="hidden sm:flex px-4 h-[56px] sm:px-8 border-b border-gray-100 items-center">
          <h1 className="text-[14px] font-normal text-[#37352f]">할 일</h1>
        </div>

        <div className="px-4 pt-8 pb-5 sm:px-8 flex items-center gap-2 overflow-x-auto no-scrollbar scroll-smooth">
          <button
            onClick={() => setFilterMode('all')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${filterMode === 'all'
              ? 'bg-[#37352f] text-white shadow-md'
              : 'bg-gray-100 text-[#1f1f1f] hover:bg-gray-200'
              }`}
          >
            모두 보기
          </button>

          {[...tabs].sort((a, b) => a.order - b.order).map(tab => (
            <div key={tab.id} className="relative group flex-shrink-0">
              <button
                onClick={() => setFilterMode(tab.id)}
                className={`px-4 py-1.5 rounded-lg text-sm transition-all whitespace-nowrap flex items-center font-medium ${filterMode === tab.id
                  ? 'text-white shadow-md'
                  : 'bg-gray-100 text-[#1f1f1f] hover:bg-gray-200'
                  }`}
                style={{
                  backgroundColor: filterMode === tab.id ? tab.color : undefined
                }}
              >
                {tab.name}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setTabSettingsModal(tab.id); }}
                className="absolute -top-1 -right-1 w-4 h-4 bg-white border border-gray-200 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
              >
                <Edit3 size={10} className="text-gray-400" />
              </button>
            </div>
          ))}

          <button
            onClick={() => setNewTabModal(true)}
            className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 hover:bg-gray-200 transition-all flex-shrink-0"
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Infinite Canvas Content Area */}
        <div className="flex-1 pt-2 pb-6 px-3 sm:px-8 min-w-fit min-h-fit">
          <SortableContext
            items={sortedLists.map(l => l.id)}
            strategy={horizontalListSortingStrategy}
          >
            <div className="flex flex-col sm:flex-row flex-wrap gap-4 sm:gap-6 items-start">
              {sortedLists.map((list) => (
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
                />
              ))}

              {/* Add List Placeholder or Button */}
              <div className="min-w-[50px] h-[50px] flex items-center justify-center opacity-50 hover:opacity-100 transition-opacity">
                <button
                  className="w-10 h-10 rounded-full bg-white shadow flex items-center justify-center text-[#1a73e8]"
                  onClick={() => setNewListModal(true)}
                >
                  <Plus />
                </button>
              </div>
            </div>
          </SortableContext>
        </div>

        {/* Drag Overlay */}
        <DragOverlay dropAnimation={dropAnimation}>
          {activeId ? (
            activeType === 'List' ? (
              <div className="w-[calc(100vw-32px)] sm:w-[300px] h-[400px] bg-white rounded-xl shadow-2xl border border-[#1a73e8] opacity-90 cursor-grabbing p-4">
                <div className="font-medium text-lg text-[#1f1f1f]">{lists.find(l => l.id === activeId)?.title}</div>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-xl border border-[#1a73e8] p-3 flex items-center gap-3 opacity-90 cursor-grabbing ring-2 ring-[#1a73e8] z-50">
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
            className="fixed bg-white rounded-lg shadow-xl border border-[#e9e9e8] py-1 z-50 w-48 animate-in fade-in zoom-in-95 duration-100"
            style={{ top: contextMenu.y, left: contextMenu.x - 180 }}
          >
            <div className="px-3 py-2 border-b border-[#f0f0ef] text-xs font-semibold text-[#9b9a97]">
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
            className="fixed bg-white rounded-lg shadow-xl border border-[#e9e9e8] py-1 z-50 w-40 animate-in fade-in zoom-in-95 duration-100"
            style={{ top: listMenu.y, left: listMenu.x - 140 }}
          >
            <div className="px-3 py-2 border-b border-[#f0f0ef] text-xs font-semibold text-[#9b9a97]">
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
        {newListModal && (
          <ListSettingsModal
            lists={lists}
            tabs={tabs}
            onClose={() => setNewListModal(false)}
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
