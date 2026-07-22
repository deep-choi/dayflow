import React, { useEffect, useState, useRef } from 'react';
import { CommunityPost, AIAgent, Comment } from '../types';
import { format, parseISO, isValid } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
    ChevronRight,
    Sparkles,
    MoreVertical,
    Edit3,
    Trash2,
    MessageSquare,
    Send,
    Hash
} from 'lucide-react';

interface CommunityBoardViewProps {
    agents: AIAgent[];
    posts: CommunityPost[];
    selectedId: string | null;
    onSelectId: (id: string | null) => void;
    selectedAgentId: string;
    onUpdatePost: (id: string, updates: Partial<CommunityPost>) => void;
    onDeletePost: (id: string) => void;
    onAddComment: (postId: string, comment: Omit<Comment, 'id' | 'timestamp'>) => void;
    onUpdateOrder?: (newPosts: CommunityPost[]) => void;
    onSelectAgent: (id: string) => void;
}

const CommunityBoardView: React.FC<CommunityBoardViewProps> = ({
    agents = [],
    posts = [],
    selectedId,
    selectedAgentId,
    onSelectId,
    onUpdatePost,
    onDeletePost,
    onAddComment,
    onSelectAgent
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState('');
    const [showActions, setShowActions] = useState(false);
    const [commentInput, setCommentInput] = useState('');
    const [isListOpen, setIsListOpen] = useState(true);
    const [visibleRows, setVisibleRows] = useState(5);
    const actionMenuRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Sync selectedId with filtered entries
    useEffect(() => {
        if (isEditing) return;
        const filtered = posts.filter(p => p.author === selectedAgentId);
        const isCurrentValid = filtered.some(p => p.id === selectedId);

        if (filtered.length > 0) {
            if (!selectedId || !isCurrentValid) {
                const sorted = [...filtered].sort((a, b) =>
                    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
                );
                onSelectId(sorted[0].id);
            }
        } else {
            if (selectedId !== null) {
                onSelectId(null);
            }
        }
    }, [posts, selectedId, selectedAgentId, onSelectId, isEditing]);

    // Click outside handler
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (actionMenuRef.current && !actionMenuRef.current.contains(event.target as Node)) {
                setShowActions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [editedContent, isEditing]);

    const handleEdit = () => {
        const post = posts.find(p => p.id === selectedId);
        if (!post) return;
        setEditedContent(post.content);
        setIsEditing(true);
        setShowActions(false);
    };

    const handleSave = () => {
        if (!selectedId) return;
        onUpdatePost(selectedId, { content: editedContent });
        setIsEditing(false);
    };

    const handleSubmitComment = () => {
        if (!selectedId || !commentInput.trim()) return;
        onAddComment(selectedId, {
            authorId: 'USER',
            authorName: '나',
            authorEmoji: '👤',
            content: commentInput.trim()
        });
        setCommentInput('');
    };

    const formatFullDate = (dateStr: string) => {
        try {
            const date = parseISO(dateStr);
            if (!isValid(date)) return '날짜 정보가 없습니다';
            return format(date, 'yyyy년 M월 d일 HH:mm', { locale: ko });
        } catch (e) {
            return '날짜 정보가 없습니다';
        }
    };

    const safeFormatTimestamp = (dateStr: string | undefined, pattern: string, fallback = '날짜 정보가 없습니다') => {
        if (!dateStr) return fallback;
        try {
            const parsed = parseISO(dateStr);
            if (!isValid(parsed)) return fallback;
            return format(parsed, pattern, { locale: ko });
        } catch {
            return fallback;
        }
    };

    const selectedPost = (posts || []).find(p => p.id === selectedId);
    const selectedAgent = agents.find(a => a.id === selectedAgentId);

    return (
        <div className="flex flex-col h-full bg-white relative overflow-hidden">
            {/* Header Area */}
            <div className="hidden min-h-16 sm:flex items-center justify-between px-8 bg-white/80 backdrop-blur-md sticky top-0 z-10 flex-shrink-0 border-b border-[#f1f1f0]">
                <div className="flex items-center gap-2 overflow-hidden text-lg font-medium text-[#9b9a97]">
                    {selectedAgent ? (
                        <>
                            <span className="truncate max-w-[120px] font-medium text-[#37352f]">{selectedAgent.name}</span>
                            <ChevronRight size={16} className="opacity-40" />
                            <span className="truncate max-w-[200px] font-medium">AI 일기장</span>
                        </>
                    ) : (
                        <span className="text-[#37352f] font-medium">AI 일기장</span>
                    )}
                </div>
            </div>

            <main className="flex-1 overflow-y-auto custom-scrollbar bg-white">
                <div className="max-w-[960px] mx-auto pt-6 pb-12 px-4 sm:py-12 sm:px-8 w-full animate-in fade-in duration-500">


                    {/* 2. Middle Section: Table-style Post List (From Image) */}
                    <div className="mb-16">
                        {/* Header Controls */}
                        <div className="flex items-center justify-between py-4 px-0 border-b border-[#f1f1f0]">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-[#37352f]">전체보기</span>
                                <span className="text-sm text-[#787774]">{posts.filter(p => p.author === selectedAgentId).length}개의 글</span>
                            </div>
                            <button
                                onClick={() => setIsListOpen(!isListOpen)}
                                className="text-sm text-[#37352f] hover:underline font-medium"
                            >
                                {isListOpen ? '목록닫기' : '목록열기'}
                            </button>
                        </div>

                        {isListOpen && (
                            <>


                                {/* Table Body */}
                                <div className="">
                                    {posts.filter(p => p.author === selectedAgentId)
                                        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                                        .slice(0, visibleRows)
                                        .map(post => {
                                            const content = typeof post.content === 'string' ? post.content : '';
                                            const lines = content.split('\n');
                                            const firstLine = lines[0] || '';
                                            const hasExplicitTitle = firstLine.startsWith('제목:');
                                            const displayTitle = hasExplicitTitle
                                                ? firstLine.replace('제목:', '').trim()
                                                : (firstLine.replace(/#+\s*/, '') || '제목 없음');

                                            return (
                                                <button
                                                    key={post.id}
                                                    onClick={() => {
                                                        const element = document.getElementById(`post-${post.id}`);
                                                        element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                                        onSelectId(post.id);
                                                    }}
                                                    className="w-full flex items-center py-4 px-0 text-left transition-colors border-b border-[#f1f1f0] group outline-none"
                                                >
                                                    <div className="flex-1 flex items-center gap-3 min-w-0 pr-4">
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <span className="text-[14px] text-[#37352f] truncate font-medium">
                                                                {displayTitle}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="w-32 flex-shrink-0 text-right text-[#9b9a97] text-[13px] tabular-nums">
                                                        {safeFormatTimestamp(post.timestamp, 'yyyy. M. d.', '-')}
                                                    </div>
                                                </button>
                                            );
                                        })
                                    }
                                </div>

                                {/* Footer Controls */}
                                <div className="flex items-center justify-end py-6">
                                    <div className="relative">
                                        <select
                                            value={visibleRows}
                                            onChange={(e) => setVisibleRows(Number(e.target.value))}
                                            className="appearance-none bg-white border border-[#e9e9e8] rounded-md px-4 py-1.5 pr-10 text-xs font-medium text-[#37352f] focus:outline-none focus:ring-2 focus:ring-[#d4d4d4]/5 cursor-pointer"
                                        >
                                            <option value={5}>5줄 보기</option>
                                            <option value={10}>10줄 보기</option>
                                            <option value={20}>20줄 보기</option>
                                        </select>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* 3. Bottom Section: Posts Vertical Feed */}
                    <div className="space-y-24">
                        {posts.filter(p => p.author === selectedAgentId)
                            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                            .map(post => {
                                const isCurrent = selectedId === post.id;
                                const isEditingThis = isEditing && isCurrent;

                                // Extract Title and Body
                                const content = typeof post.content === 'string' ? post.content : '';
                                const lines = content.split('\n');
                                const firstLine = lines[0] || '';
                                const hasExplicitTitle = firstLine.startsWith('제목:');
                                const displayTitle = hasExplicitTitle
                                    ? firstLine.replace('제목:', '').trim()
                                    : (firstLine.replace(/#+\s*/, '') || '제목 없음');
                                const displayBody = lines.slice(1).join('\n').trim();

                                const formattedDate = safeFormatTimestamp(post.timestamp, 'yyyy년 M월 d일 HH:mm');

                                return (
                                    <article
                                        key={post.id}
                                        id={`post-${post.id}`}
                                        className="scroll-mt-24 transition-all duration-500 opacity-100"
                                    >
                                        <div className="space-y-8">
                                            {isEditingThis ? (
                                                <div className="space-y-6">
                                                    <textarea
                                                        ref={textareaRef}
                                                        value={editedContent}
                                                        onChange={e => setEditedContent(e.target.value)}
                                                        className="w-full text-[15px] leading-7 text-[#37352f] border-none focus:ring-0 outline-none p-0 resize-none placeholder-[#e1e1e0] overflow-hidden font-sans"
                                                        autoFocus
                                                    />
                                                    <div className="flex justify-end gap-3 pt-8 border-t border-[#f1f1f0]">
                                                        <button onClick={() => setIsEditing(false)} className="px-5 py-2.5 text-sm font-medium text-[#787774] hover:bg-[#f5f5f5] rounded-xl transition-colors">취소</button>
                                                        <button onClick={handleSave} className="px-8 py-2.5 bg-[var(--color-primary)] text-white text-sm font-medium rounded-xl hover:bg-[var(--color-primary-hover)] transition-all shadow-sm">저장</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    {/* 1. Title */}
                                                    <h2 className="text-2xl font-medium tracking-tight text-[#37352f] leading-tight font-sans">
                                                        {displayTitle}
                                                    </h2>

                                                    {/* 2. Meta Row (Date + Actions) */}
                                                    <div className="flex items-center justify-between border-b border-[#f1f1f0] pb-6">
                                                        <div className="flex items-center gap-3 text-xs text-[#9b9a97]">
                                                            {/* Persona Profile Image (32px) */}
                                                            <div className="w-8 h-8 rounded-full overflow-hidden border border-[#e9e9e8] flex-shrink-0 flex items-center justify-center bg-[#f7f7f5]">
                                                                {selectedAgent?.avatar ? (
                                                                    <img src={selectedAgent.avatar} alt={selectedAgent.name} className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <span className="text-base">{selectedAgent?.emoji}</span>
                                                                )}
                                                            </div>
                                                            <span className="font-medium text-[#787774]">
                                                                {formattedDate}
                                                            </span>
                                                        </div>

                                                        <div className="relative" ref={isCurrent ? actionMenuRef : null}>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    onSelectId(post.id);
                                                                    setShowActions(!showActions);
                                                                }}
                                                                className="p-2 hover:bg-[#f2f2f0] rounded-lg transition-all text-[#9b9a97] hover:text-[#37352f]"
                                                            >
                                                                <MoreVertical size={18} />
                                                            </button>
                                                            {showActions && isCurrent && (
                                                                <div className="absolute right-0 mt-2 w-36 bg-white border border-[#e9e9e8] rounded-xl z-20 py-1.5 animate-in fade-in zoom-in-95 duration-100 ring-1 ring-black/5">
                                                                    <button onClick={handleEdit} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[#37352f] hover:bg-[#f7f7f5] transition-colors text-left font-medium">
                                                                        <Edit3 size={14} className="text-[#9b9a97]" /> 수정하기
                                                                    </button>
                                                                    <button onClick={() => { onDeletePost(post.id); setShowActions(false); }} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[#eb5757] hover:bg-[#fff0f0] transition-colors text-left font-medium">
                                                                        <Trash2 size={14} /> 삭제하기
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* 3. Body */}
                                                    <div className="text-[15px] leading-7 text-[#37352f] whitespace-pre-wrap font-sans">
                                                        {displayBody}
                                                    </div>

                                                    {/* 4. Comments */}
                                                    <div className="pt-10 border-t border-[#f1f1f0] space-y-6">
                                                        <div className="flex items-center gap-2">
                                                            <MessageSquare size={16} className="text-[#9b9a97]" />
                                                            <span className="text-sm font-medium text-[#37352f]">댓글 {post.comments?.length || 0}</span>
                                                        </div>

                                                        {isCurrent && (
                                                            <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
                                                                {post.comments?.map(comment => (
                                                                    <div key={comment.id} className="flex gap-3">
                                                                        <div className="w-8 h-8 rounded-full bg-[#f7f7f5] flex items-center justify-center text-xs flex-shrink-0 mt-0.5 border border-[#e9e9e8]">
                                                                            {comment.authorEmoji}
                                                                        </div>
                                                                        <div className="flex-1 space-y-1">
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="text-xs font-medium text-[#37352f]">{comment.authorName}</span>
                                                                                <span className="text-xs text-[#9b9a97]">{safeFormatTimestamp(comment.timestamp, 'MM.dd HH:mm', '-')}</span>
                                                                            </div>
                                                                            <p className="text-sm text-[#37352f] bg-[#f7f7f5]/50 p-3 rounded-2xl border border-[#f1f1f0] inline-block">
                                                                                {comment.content}
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                                <div className="flex gap-3 pt-4">
                                                                    <div className="w-8 h-8 rounded-full bg-[#f7f7f5] flex items-center justify-center text-xs flex-shrink-0 mt-0.5 border border-[#e9e9e8]">👤</div>
                                                                    <div className="flex-1 relative">
                                                                        <textarea
                                                                            value={commentInput}
                                                                            onChange={e => setCommentInput(e.target.value)}
                                                                            placeholder="기록에 댓글 남기기..."
                                                                            className="w-full bg-[#f7f7f5] border border-[#e9e9e8] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#d4d4d4]/5 transition-all outline-none resize-none pr-12 min-h-[46px]"
                                                                            rows={1}
                                                                            onKeyDown={e => {
                                                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                                                    e.preventDefault();
                                                                                    handleSubmitComment();
                                                                                }
                                                                            }}
                                                                        />
                                                                        <button
                                                                            onClick={handleSubmitComment}
                                                                            disabled={!commentInput.trim()}
                                                                            className="absolute right-2 top-1.5 p-2 bg-[#f7f7f7] text-[#171717] border border-[#e9e9e8] rounded-lg hover:bg-[#eeeeee] disabled:opacity-20"
                                                                        >
                                                                            <Send size={14} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </article>
                                );
                            })
                        }

                        {posts.filter(p => p.author === selectedAgentId).length === 0 && (
                            <div className="h-[40vh] flex flex-col items-center justify-center text-[#d3d1cb] space-y-6">
                                <div className="p-10 bg-[#f7f7f5] rounded-3xl border border-[#e9e9e8]">
                                    <Sparkles size={64} className="opacity-10 text-[#37352f]" strokeWidth={1} />
                                </div>
                                <p className="text-xl font-medium text-[#37352f]">작성된 기록이 없습니다.</p>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default CommunityBoardView;
