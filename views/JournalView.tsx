import React, { useEffect, useMemo, useRef, useState } from 'react';
import { JournalEntry, JournalCategory } from '../types';
import {
  Trash2,
  Plus,
  BookOpen,
  Edit3,
  Search,
  MoreVertical,
} from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';
import { ko } from 'date-fns/locale';

interface JournalViewProps {
  entries: JournalEntry[];
  categories: JournalCategory[];
  selectedId: string | null;
  selectedCategory: string | 'all';
  searchQuery: string;
  onSelectId: (id: string | null) => void;
  onSelectCategory: (category: string) => void;
  onSearchQuery: (query: string) => void;
  onAddCategory: (name: string) => void | Promise<void>;
  onAddEntry: (title: string, content: string, category: string) => void;
  onUpdateEntry: (id: string, updates: Partial<JournalEntry>) => void;
  onDeleteEntry: (id: string) => void;
}

const DEFAULT_CATEGORY_NAME = '메모장';

const getEntryTime = (dateStr?: string): number => {
  if (!dateStr) return 0;
  try {
    const date = parseISO(dateStr);
    return isValid(date) ? date.getTime() : 0;
  } catch {
    return 0;
  }
};

const formatDateShort = (dateStr?: string): string => {
  try {
    const date = dateStr ? parseISO(dateStr) : null;
    if (!date || !isValid(date)) return '';
    return format(date, 'M월 d일', { locale: ko });
  } catch {
    return '';
  }
};

const formatDateLong = (dateStr?: string): string => {
  try {
    const date = dateStr ? parseISO(dateStr) : null;
    if (!date || !isValid(date)) return '날짜 정보가 없습니다';
    return format(date, 'yyyy년 M월 d일 HH:mm', { locale: ko });
  } catch {
    return '날짜 정보가 없습니다';
  }
};

const getCategoryClassName = (category?: string): string => {
  return 'bg-[#f7f7f7] text-[#5f5f5f]';
};

const JournalView: React.FC<JournalViewProps> = ({
  entries = [],
  categories = [],
  selectedId,
  selectedCategory,
  searchQuery,
  onSelectId,
  onSearchQuery,
  onAddCategory,
  onAddEntry,
  onUpdateEntry,
  onDeleteEntry,
}) => {
  const [isWriting, setIsWriting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [categoryInput, setCategoryInput] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState(categories[0]?.name || DEFAULT_CATEGORY_NAME);

  const actionMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const categoryInputRef = useRef<HTMLInputElement>(null);

  const categoryOptions = useMemo<JournalCategory[]>(
    () => categories.length > 0 ? categories : [{ id: 'default', name: DEFAULT_CATEGORY_NAME }],
    [categories]
  );

  const defaultCategoryName = categoryOptions[0]?.name || DEFAULT_CATEGORY_NAME;
  const categorySelectOptions = useMemo<JournalCategory[]>(() => {
    if (!newCategory || categoryOptions.some(category => category.name === newCategory)) {
      return categoryOptions;
    }

    return [...categoryOptions, { id: `draft-${newCategory}`, name: newCategory }];
  }, [categoryOptions, newCategory]);

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return [...entries]
      .filter(entry => {
        const matchesCategory = selectedCategory === 'all' || entry.category === selectedCategory;
        const searchableText = `${entry.title || ''} ${entry.content || ''}`.toLowerCase();
        return matchesCategory && (!query || searchableText.includes(query));
      })
      .sort((a, b) => getEntryTime(b.date) - getEntryTime(a.date));
  }, [entries, searchQuery, selectedCategory]);

  const selectedEntry = entries.find(entry => entry.id === selectedId);

  useEffect(() => {
    if (isWriting) return;

    if (filteredEntries.length > 0) {
      if (!selectedId || !filteredEntries.some(entry => entry.id === selectedId)) {
        onSelectId(filteredEntries[0].id);
      }
      return;
    }

    if (selectedId !== null) {
      onSelectId(null);
    }
  }, [filteredEntries, isWriting, onSelectId, selectedId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target as Node)) {
        setShowActions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
  }, [isWriting, newContent]);

  useEffect(() => {
    if (isAddingCategory) categoryInputRef.current?.focus();
  }, [isAddingCategory]);

  const resetDraft = () => {
    setNewTitle('');
    setNewContent('');
    setEditingId(null);
    setCategoryInput('');
    setIsAddingCategory(false);
  };

  const startWriting = () => {
    resetDraft();
    setNewCategory(selectedCategory !== 'all' ? selectedCategory : defaultCategoryName);
    setShowActions(false);
    setIsWriting(true);
  };

  const cancelWriting = () => {
    resetDraft();
    setIsWriting(false);
  };

  const handleCreate = () => {
    const title = newTitle.trim();
    const content = newContent.trim();
    if (!title || !content) return;

    if (editingId) {
      onUpdateEntry(editingId, { title, content, category: newCategory });
    } else {
      onAddEntry(title, content, newCategory);
    }

    resetDraft();
    setIsWriting(false);
  };

  const handleEdit = () => {
    if (!selectedEntry) return;
    setNewTitle(selectedEntry.title || '');
    setNewContent(selectedEntry.content || '');
    setNewCategory(selectedEntry.category || defaultCategoryName);
    setEditingId(selectedEntry.id);
    setIsWriting(true);
    setShowActions(false);
  };

  const handleDelete = () => {
    if (!selectedId) return;
    if (window.confirm('정말로 이 메모를 삭제하시겠습니까?')) {
      onDeleteEntry(selectedId);
      onSelectId(null);
      setShowActions(false);
    }
  };

  const submitCategory = async () => {
    const name = categoryInput.trim();
    if (!name || name === '전체') return;

    if (!categoryOptions.some(category => category.name === name)) {
      await onAddCategory(name);
    }

    setNewCategory(name);
    setCategoryInput('');
    setIsAddingCategory(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex min-h-16 flex-col gap-3 border-b border-[#e9e9e8] px-4 py-3 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-lg font-medium text-[#171717]">메모장</h1>
        </div>

        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
          <div className="relative w-full sm:w-64">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9a97]" />
            <input
              type="text"
              placeholder="메모 검색"
              value={searchQuery}
              onChange={(event) => onSearchQuery(event.target.value)}
              className="h-10 w-full rounded-lg border border-[#e9e9e8] bg-white pl-10 pr-4 text-sm font-normal text-[#171717] transition-colors placeholder:text-[#b5b5b5] focus:border-[var(--color-primary)] focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={startWriting}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-primary-hover)]"
          >
            <Plus size={18} />
            새 메모
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <aside className="h-[34vh] min-h-[220px] w-full overflow-y-auto border-b border-[#e9e9e8] bg-[#fbfbfa] custom-scrollbar lg:h-auto lg:min-h-0 lg:w-[360px] lg:border-b-0 lg:border-r">
          {filteredEntries.map(entry => {
            const isSelected = selectedId === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  onSelectId(entry.id);
                  setIsWriting(false);
                }}
                className={`w-full border-b border-l-2 border-b-[#e9e9e8] p-4 text-left transition-colors sm:p-5 ${
                  isSelected
                    ? 'border-l-[#d4d4d4] bg-white'
                    : 'border-l-transparent border-t-transparent border-r-transparent hover:bg-white/50'
                }`}
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <h3 className={`min-w-0 flex-1 truncate text-[15px] font-medium ${isSelected ? 'text-[#171717]' : 'text-[#37352f]'}`}>
                    {entry.title || '제목 없음'}
                  </h3>
                  <span className="shrink-0 text-[13px] leading-5 font-normal text-[#9b9a97]">
                    {formatDateShort(entry.date)}
                  </span>
                </div>

                <p className="mb-3 line-clamp-2 text-sm font-normal leading-relaxed text-[#8a8a8a]">
                  {entry.content || '내용 없음'}
                </p>

                <span className={`inline-flex rounded px-2 py-0.5 text-[13px] leading-5 font-medium ${getCategoryClassName(entry.category)}`}>
                  {entry.category || DEFAULT_CATEGORY_NAME}
                </span>
              </button>
            );
          })}

          {filteredEntries.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center text-[#9b9a97]">
              <Search size={36} className="mb-4 opacity-20" />
              <p className="text-sm font-normal">검색 결과가 없습니다.</p>
            </div>
          )}
        </aside>

        <main className="min-h-0 flex-1 overflow-y-auto bg-white custom-scrollbar">
          {isWriting ? (
            <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-4 py-8 sm:px-8 sm:py-10">
              <div className="mb-8 flex flex-col gap-5 border-b border-[#e9e9e8] pb-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[13px] leading-5 font-medium text-[#8a8a8a]">카테고리</span>
                    <select
                      value={newCategory}
                      onChange={event => setNewCategory(event.target.value)}
                      className="h-11 min-w-[140px] cursor-pointer rounded-xl border border-[#e9e9e8] bg-white px-4 text-sm font-normal text-[#171717] outline-none transition-colors hover:bg-[#f7f7f7] focus:border-[var(--color-primary)]"
                    >
                      {categorySelectOptions.map(category => (
                        <option key={category.id} value={category.name}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setIsAddingCategory(value => !value)}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium text-[#787774] transition-colors hover:bg-[#f7f7f7] hover:text-[#171717]"
                    >
                      <Plus size={15} />
                      카테고리
                    </button>
                  </div>

                  {isAddingCategory && (
                    <div className="mt-3 flex max-w-[430px] items-center gap-2">
                      <input
                        ref={categoryInputRef}
                        type="text"
                        value={categoryInput}
                        onChange={event => setCategoryInput(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') void submitCategory();
                          if (event.key === 'Escape') {
                            setCategoryInput('');
                            setIsAddingCategory(false);
                          }
                        }}
                        placeholder="새 카테고리"
                        className="h-11 min-w-0 flex-1 rounded-xl border border-[#e9e9e8] bg-white px-4 text-sm font-normal text-[#171717] outline-none transition-colors placeholder:text-[#b5b5b5] focus:border-[var(--color-primary)]"
                      />
                      <button
                        type="button"
                        onClick={() => void submitCategory()}
                        disabled={!categoryInput.trim()}
                        className="h-11 rounded-xl bg-[#f7f7f7] px-4 text-sm font-medium text-[#171717] transition-colors hover:bg-[#eeeeee] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        추가
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={cancelWriting}
                    className="h-11 rounded-xl px-4 text-sm font-normal text-[#787774] transition-colors hover:bg-[#f7f7f7]"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={!newTitle.trim() || !newContent.trim()}
                    className="h-11 rounded-xl bg-[#f7f7f7] px-5 text-sm font-medium text-[#171717] transition-colors hover:bg-[#eeeeee] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {editingId ? '수정 완료' : '메모 저장'}
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="제목을 입력하세요"
                  value={newTitle}
                  onChange={event => setNewTitle(event.target.value)}
                  className="w-full border-none bg-transparent px-0 py-2 text-[20px] font-medium tracking-normal text-[#171717] placeholder:text-[#c8c8c8] outline-none focus:ring-0"
                  autoFocus
                />
                <textarea
                  ref={textareaRef}
                  placeholder="내용을 입력하세요..."
                  value={newContent}
                  onChange={event => setNewContent(event.target.value)}
                  className="min-h-[420px] w-full resize-none overflow-hidden border-none bg-transparent px-0 py-2 text-[15px] font-normal leading-7 text-[#37352f] placeholder:text-[#c8c8c8] outline-none focus:ring-0"
                />
              </div>
            </div>
          ) : selectedEntry ? (
            <div className="mx-auto max-w-[720px] px-4 py-8 sm:px-8 sm:py-10">
              <div className="mb-8 flex items-center justify-between gap-3">
                <span className={`inline-flex rounded px-2.5 py-1 text-[13px] leading-5 font-medium ${getCategoryClassName(selectedEntry.category)}`}>
                  {selectedEntry.category || DEFAULT_CATEGORY_NAME}
                </span>

                <div className="relative" ref={actionMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowActions(!showActions)}
                    className="rounded-full p-2 text-[#9b9a97] transition-colors hover:bg-[#f7f7f7] hover:text-[#171717]"
                    aria-label="메모 작업"
                  >
                    <MoreVertical size={20} />
                  </button>

                  {showActions && (
                    <div className="absolute right-0 z-20 mt-2 w-36 overflow-hidden rounded-lg border border-[#e9e9e8] bg-white py-1">
                      <button
                        type="button"
                        onClick={handleEdit}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-[#171717] transition-colors hover:bg-[#f7f7f7]"
                      >
                        <Edit3 size={16} className="text-[#9b9a97]" />
                        수정하기
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-[#ef4444] transition-colors hover:bg-red-50"
                      >
                        <Trash2 size={16} />
                        삭제하기
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <h1 className="mb-5 text-[20px] font-medium leading-tight tracking-normal text-[#171717]">
                {selectedEntry.title || '제목 없음'}
              </h1>

              <div className="mb-10 flex items-center gap-2 border-b border-[#e9e9e8] pb-5 text-[13px] leading-5 font-normal text-[#9b9a97]">
                <span className="font-medium text-[#37352f]">작성일</span>
                <span className="h-1 w-1 rounded-full bg-[#e9e9e8]" />
                <span>{formatDateLong(selectedEntry.date)}</span>
              </div>

              <div className="min-h-[320px] whitespace-pre-wrap text-base font-normal leading-7 text-[#37352f]">
                {selectedEntry.content}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center sm:p-12">
              <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-[#f7f7f7]">
                <BookOpen size={34} className="text-[#9b9a97]" strokeWidth={1.5} />
              </div>
              <h2 className="mb-2 text-base font-medium text-[#171717]">메모를 선택하거나 새로 작성하세요</h2>
              <p className="max-w-[280px] text-sm font-normal leading-relaxed text-[#8a8a8a]">
                메모를 선택해 내용을 확인하거나, 오른쪽 상단의 새 메모 버튼으로 시작하세요.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default JournalView;
