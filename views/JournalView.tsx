import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { JournalEntry, JournalCategory } from '../types';
import {
  Trash2,
  Plus,
  BookOpen,
  Edit3,
  Search,
  MoreVertical,
  ChevronLeft,
  ChevronDown,
  Check,
} from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useBackLayer } from '../hooks/useBackLayer';
import { COMPACT_LAYOUT_QUERY, useMediaQuery } from '../hooks/useMediaQuery';

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
  sidebarSlot?: HTMLElement | null;
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
  onSelectCategory,
  onSearchQuery,
  onAddCategory,
  onAddEntry,
  onUpdateEntry,
  onDeleteEntry,
  sidebarSlot,
}) => {
  const hasSidebarSlot = Boolean(sidebarSlot);
  const [isWriting, setIsWriting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const [categoryInput, setCategoryInput] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState(categories[0]?.name || DEFAULT_CATEGORY_NAME);

  const actionMenuRef = useRef<HTMLDivElement>(null);
  const categoryMenuRef = useRef<HTMLDivElement>(null);
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
      setShowMobileDetail(false);
    }
  }, [filteredEntries, isWriting, onSelectId, selectedId]);

  useEffect(() => {
    if (!selectedId) setShowMobileDetail(false);
  }, [selectedId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target as Node)) {
        setShowActions(false);
      }
      if (categoryMenuRef.current && !categoryMenuRef.current.contains(event.target as Node)) {
        setIsCategoryMenuOpen(false);
        setIsAddingCategory(false);
        setCategoryInput('');
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
    setIsCategoryMenuOpen(false);
  };

  const startWriting = () => {
    resetDraft();
    setNewCategory(selectedCategory !== 'all' ? selectedCategory : defaultCategoryName);
    setShowActions(false);
    setShowMobileDetail(true);
    setIsWriting(true);
  };

  const cancelWriting = () => {
    const wasEditing = Boolean(editingId);
    resetDraft();
    setShowMobileDetail(wasEditing);
    setIsWriting(false);
  };

  const handleCreate = () => {
    const title = newTitle.trim();
    const content = newContent.trim();
    if (!title && !content) return;

    if (editingId) {
      onUpdateEntry(editingId, { title, content, category: newCategory });
    } else {
      onAddEntry(title, content, newCategory);
    }

    resetDraft();
    setShowMobileDetail(true);
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
      setShowMobileDetail(false);
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
    setIsCategoryMenuOpen(false);
  };

  const isCompactLayout = useMediaQuery(COMPACT_LAYOUT_QUERY);
  useBackLayer(isCompactLayout && (showMobileDetail || isWriting), () => {
    if (isWriting) cancelWriting();
    else setShowMobileDetail(false);
  });

  const canSaveDraft = Boolean(newTitle.trim() || newContent.trim());
  const editingEntry = editingId ? entries.find(entry => entry.id === editingId) : undefined;

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && (event.key === 'Enter' || event.key === 's')) {
      event.preventDefault();
      if (canSaveDraft) handleCreate();
    }
  };

  const sidebarContent = (
    <>
      <button
        type="button"
        onClick={startWriting}
        className="w-full flex items-center gap-2.5 rounded-lg bg-[#f7f7f7] px-3 py-2.5 text-[15px] leading-5 font-medium text-[#37352f] transition-colors hover:bg-[#eeeeee]"
      >
        <Plus size={18} className="shrink-0" />
        <span>새 메모</span>
      </button>

      <div className="relative mt-2">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9a97]" />
        <input
          type="text"
          placeholder="메모 검색"
          value={searchQuery}
          onChange={(event) => onSearchQuery(event.target.value)}
          className="h-9 w-full rounded-lg border border-[#e9e9e8] bg-white pl-9 pr-3 text-[14px] font-normal text-[#171717] transition-colors placeholder:text-[#b5b5b5] focus:border-[var(--color-primary)] focus:outline-none"
        />
      </div>

      <div className="mt-6 mb-1 px-3">
        <span className="text-[13px] leading-5 font-normal text-[#8a8a8a]">카테고리</span>
      </div>
      <div className="space-y-0.5">
        {[{ id: 'all', name: 'all', label: '전체', count: entries.length }, ...categories.map(category => ({
          id: category.id,
          name: category.name,
          label: category.name,
          count: entries.filter(entry => entry.category === category.name).length,
        }))].map(item => {
          const isActive = selectedCategory === item.name;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectCategory(item.name)}
              className={`w-full flex items-center px-3 py-2 rounded-lg transition-colors text-[15px] leading-5 ${isActive ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)] font-medium' : 'font-normal text-[#5f5f5f] hover:bg-[#f7f7f7] hover:text-[#171717]'}`}
            >
              <span className="truncate flex-1 text-left">{item.label}</span>
              <span className={`text-[13px] leading-5 ${isActive ? 'font-medium text-[var(--color-primary)]' : 'font-normal text-[#8a8a8a]'}`}>{item.count}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 mb-1 px-3">
        <span className="text-[13px] leading-5 font-normal text-[#8a8a8a]">메모</span>
      </div>
      <div className="space-y-0.5">
        {filteredEntries.length === 0 ? (
          <div className="px-3 py-2 text-[13px] leading-5 text-[#8a8a8a]">
            {entries.length === 0 ? '아직 메모가 없습니다.' : '검색 결과가 없습니다.'}
          </div>
        ) : (
          filteredEntries.map(entry => {
            const isSelected = !isWriting && selectedId === entry.id;

            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  onSelectId(entry.id);
                  setIsWriting(false);
                  resetDraft();
                }}
                className={`journal-record-item w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] leading-5 transition-colors ${
                  isSelected
                    ? 'bg-[#f7f7f7] text-[#171717] font-medium'
                    : 'font-normal text-[#5f5f5f] hover:bg-[#f7f7f7] hover:text-[#171717]'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{entry.title || '제목 없음'}</span>
                <span className="shrink-0 text-[12px] leading-4 font-normal text-[#9b9a97]">{formatDateShort(entry.date)}</span>
              </button>
            );
          })
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {sidebarSlot && createPortal(sidebarContent, sidebarSlot)}
      <header className={`${isWriting || showMobileDetail ? 'hidden lg:flex' : 'flex'} ${hasSidebarSlot ? 'lg:hidden' : ''} min-h-16 flex-col gap-3 border-[#e9e9e8] px-4 py-3 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:border-b`}>
        <div className="hidden lg:block">
          <h1 className="text-lg font-medium text-[#171717]">메모장</h1>
        </div>

        <div className="flex w-full items-center gap-2 lg:w-auto">
          <div className="relative min-w-0 flex-1 lg:w-64 lg:flex-none">
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
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] text-sm font-medium text-white transition-colors hover:bg-[var(--color-primary-hover)] lg:w-auto lg:px-4"
            aria-label="새 메모"
            title="새 메모"
          >
            <Plus size={18} />
            <span className="hidden lg:inline">새 메모</span>
          </button>
        </div>
      </header>

      {categories.length > 0 && (
        <div className={`${isWriting || showMobileDetail ? 'hidden lg:flex' : 'flex'} ${hasSidebarSlot ? 'lg:hidden' : ''} shrink-0 items-center gap-2 overflow-x-auto border-[#e9e9e8] px-4 pb-3 no-scrollbar sm:px-8 lg:border-b lg:py-2.5`}>
          {[{ id: 'all', name: 'all', label: '전체' }, ...categories.map(category => ({ id: category.id, name: category.name, label: category.name }))].map(item => {
            const isActive = selectedCategory === item.name;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectCategory(item.name)}
                className={`inline-flex h-8 shrink-0 items-center rounded-full px-3.5 text-[13px] leading-5 font-medium whitespace-nowrap transition-colors ${isActive
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'bg-[#f7f7f7] text-[#5f5f5f] hover:bg-[#eeeeee] hover:text-[#171717]'}`}
                aria-pressed={isActive}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <aside className={`${isWriting || showMobileDetail ? 'hidden lg:block' : 'block'} ${hasSidebarSlot ? 'lg:hidden' : ''} journal-entry-list h-full min-h-0 w-full space-y-1 overflow-y-auto border-[#e9e9e8] bg-[#fbfbfa] px-2 pb-6 custom-scrollbar lg:h-auto lg:w-[360px] lg:space-y-0 lg:border-r lg:p-0`}>
          {filteredEntries.map(entry => {
            const isSelected = selectedId === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  onSelectId(entry.id);
                  setShowMobileDetail(true);
                  setIsWriting(false);
                }}
                className={`journal-entry-list-item w-full rounded-xl border-0 border-b-[#e9e9e8] px-3 py-3.5 text-left transition-colors max-lg:hover:bg-[#f7f7f7] max-lg:active:bg-[#f7f7f7] sm:px-4 sm:py-4 lg:rounded-none lg:border-b lg:border-l-2 lg:p-5 ${
                  isSelected
                    ? 'is-selected lg:border-l-[var(--color-primary)] lg:bg-white'
                    : 'border-l-transparent border-t-transparent border-r-transparent hover:bg-white/50'
                }`}
              >
                <div className="mb-1 flex items-start justify-between gap-3 sm:mb-2">
                  <h3 className={`min-w-0 flex-1 truncate text-[15px] font-medium ${isSelected ? 'text-[#171717]' : 'text-[#37352f]'}`}>
                    {entry.title || '제목 없음'}
                  </h3>
                  <span className="shrink-0 text-[13px] leading-5 font-normal text-[#9b9a97]">
                    {formatDateShort(entry.date)}
                  </span>
                </div>

                <p className="mb-2 line-clamp-1 text-sm font-normal leading-relaxed text-[#8a8a8a] sm:mb-3 sm:line-clamp-2">
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

        <main className={`${!isWriting && !showMobileDetail ? 'hidden lg:block' : 'block'} min-h-0 flex-1 overflow-y-auto bg-white custom-scrollbar`}>
          {isWriting ? (
            <div className="flex min-h-full flex-col" onKeyDown={handleEditorKeyDown}>
              <div className="sticky top-0 z-10 flex h-12 lg:h-14 shrink-0 items-center justify-between gap-3 border-b border-[#e9e9e8] bg-white px-4 sm:px-8">
                <div className="flex min-w-0 items-center">
                  <button
                    type="button"
                    onClick={cancelWriting}
                    className="inline-flex h-9 items-center gap-1 rounded-lg pr-3 text-sm font-medium text-[#5f5f5f] lg:hidden"
                  >
                    <ChevronLeft size={18} />
                    목록
                  </button>
                  <span className="hidden truncate text-[14px] leading-5 font-normal text-[#8a8a8a] lg:inline">
                    {editingId ? '메모 수정' : '새 메모'}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="mr-2 hidden text-[13px] leading-5 font-normal text-[#b5b5b5] xl:inline">Ctrl + Enter로 저장</span>
                  <button
                    type="button"
                    onClick={cancelWriting}
                    className="h-9 rounded-lg px-3 text-sm font-normal text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7] hover:text-[#171717]"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={!canSaveDraft}
                    className="h-9 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {editingId ? '수정 완료' : '저장'}
                  </button>
                </div>
              </div>

              <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-4 py-6 sm:px-8 sm:py-10">
                {/* Category picker: styled like the category chip in the detail view */}
                <div className="relative mb-6 self-start" ref={categoryMenuRef}>
                  <button
                    type="button"
                    onClick={() => setIsCategoryMenuOpen(value => !value)}
                    className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-[13px] leading-5 font-medium transition-colors ${isCategoryMenuOpen ? 'bg-[#eeeeee] text-[#171717]' : 'bg-[#f7f7f7] text-[#5f5f5f] hover:bg-[#eeeeee] hover:text-[#171717]'}`}
                    aria-haspopup="listbox"
                    aria-expanded={isCategoryMenuOpen}
                  >
                    {newCategory}
                    <ChevronDown size={14} />
                  </button>

                  {isCategoryMenuOpen && (
                    <div className="absolute left-0 top-full z-20 mt-1.5 w-56 rounded-xl border border-[#e9e9e8] bg-white py-1.5">
                      <div className="max-h-60 overflow-y-auto px-1 custom-scrollbar" role="listbox">
                        {categorySelectOptions.map(category => (
                          <button
                            key={category.id}
                            type="button"
                            role="option"
                            aria-selected={newCategory === category.name}
                            onClick={() => {
                              setNewCategory(category.name);
                              setIsCategoryMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-normal text-[#37352f] transition-colors hover:bg-[#f7f7f7]"
                          >
                            <span className="min-w-0 flex-1 truncate">{category.name}</span>
                            {newCategory === category.name && <Check size={14} className="shrink-0 text-[var(--color-primary)]" />}
                          </button>
                        ))}
                      </div>

                      <div className="my-1 border-t border-[#e9e9e8]" />

                      <div className="px-1">
                        {isAddingCategory ? (
                          <div className="px-2 py-1">
                            <input
                              ref={categoryInputRef}
                              type="text"
                              value={categoryInput}
                              onChange={event => setCategoryInput(event.target.value)}
                              onKeyDown={event => {
                                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                                  event.preventDefault();
                                  void submitCategory();
                                }
                                if (event.key === 'Escape') {
                                  setCategoryInput('');
                                  setIsAddingCategory(false);
                                }
                              }}
                              placeholder="새 카테고리 이름"
                              className="h-9 w-full rounded-lg border border-[#e9e9e8] bg-white px-3 text-sm font-normal text-[#171717] outline-none transition-colors placeholder:text-[#b5b5b5] focus:border-[var(--color-primary)]"
                            />
                            <p className="mt-1.5 px-1 text-[13px] leading-5 font-normal text-[#9b9a97]">Enter로 추가</p>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setIsAddingCategory(true)}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-normal text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7] hover:text-[#171717]"
                          >
                            <Plus size={14} className="shrink-0" />
                            새 카테고리
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <input
                  type="text"
                  placeholder="제목"
                  value={newTitle}
                  onChange={event => setNewTitle(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing && !event.metaKey && !event.ctrlKey) {
                      event.preventDefault();
                      textareaRef.current?.focus();
                    }
                  }}
                  className="w-full border-none bg-transparent p-0 text-[24px] leading-8 font-medium tracking-normal text-[#171717] placeholder:text-[#c8c8c8] outline-none focus:ring-0"
                  autoFocus
                />

                <div className="mt-4 mb-8 flex items-center gap-2 border-b border-[#e9e9e8] pb-5 text-[13px] leading-5 font-normal text-[#9b9a97]">
                  <span className="font-medium text-[#37352f]">작성일</span>
                  <span className="h-1 w-1 rounded-full bg-[#e9e9e8]" />
                  <span>{formatDateLong(editingEntry?.date ?? new Date().toISOString())}</span>
                </div>

                <textarea
                  ref={textareaRef}
                  placeholder="내용을 입력하세요"
                  value={newContent}
                  onChange={event => setNewContent(event.target.value)}
                  className="min-h-[320px] w-full flex-1 resize-none overflow-hidden border-none bg-transparent p-0 text-base font-normal leading-7 text-[#37352f] placeholder:text-[#c8c8c8] outline-none focus:ring-0"
                />
              </div>
            </div>
          ) : selectedEntry ? (
            <div className="mx-auto max-w-[720px] px-4 py-5 sm:px-8 sm:py-10">
              <div className="mb-5 flex items-center justify-between lg:hidden">
                <button
                  type="button"
                  onClick={() => {
                    setShowMobileDetail(false);
                    setShowActions(false);
                  }}
                  className="inline-flex h-9 items-center gap-1 rounded-lg pr-3 text-sm font-medium text-[#5f5f5f]"
                >
                  <ChevronLeft size={18} />
                  목록
                </button>
              </div>

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
                {hasSidebarSlot
                  ? '메모를 선택해 내용을 확인하거나, 왼쪽의 새 메모 버튼으로 시작하세요.'
                  : '메모를 선택해 내용을 확인하거나, 오른쪽 상단의 새 메모 버튼으로 시작하세요.'}
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default JournalView;
