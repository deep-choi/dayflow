import React, { useState, useEffect, useRef } from 'react';
import { CalendarEvent, CalendarTag } from '../types';
import { ChevronLeft, ChevronRight, Plus, X, Trash2, CalendarIcon, Check, Clock, AlignLeft } from '../components/Icons';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, startOfWeek, endOfWeek, parseISO, isToday as dfIsToday } from 'date-fns';
import { ko } from 'date-fns/locale/ko';
import { getDarkAdaptiveColor } from '../utils/colorPalette';

interface CalendarViewProps {
  events: CalendarEvent[];
  tags: CalendarTag[];
  onAddEvent: (event: CalendarEvent) => void;
  onDeleteEvent: (id: string) => void;
  onUpdateEvent: (event: CalendarEvent, previous: CalendarEvent) => void;
}

const CalendarView: React.FC<CalendarViewProps> = ({ events, tags, onAddEvent, onDeleteEvent, onUpdateEvent }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const lastWheelTime = useRef<number>(0);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [isAllDay, setIsAllDay] = useState(false);
  const [description, setDescription] = useState('');
  const [type, setType] = useState<CalendarEvent['type']>(tags?.[0]?.id || 'tag_1');

  // Time Picker UI State
  const [showStartHourPicker, setShowStartHourPicker] = useState(false);
  const [showStartMinPicker, setShowStartMinPicker] = useState(false);
  const [showEndHourPicker, setShowEndHourPicker] = useState(false);
  const [showEndMinPicker, setShowEndMinPicker] = useState(false);

  const hourOptions = Array.from({ length: 12 }, (_, i) => i + 1);
  const minuteOptions = ['00', '10', '20', '30', '40', '50'];

  const getAmPm = (timeStr: string) => {
    if (!timeStr) return '오전';
    const hour = parseInt(timeStr.split(':')[0]);
    return hour >= 12 ? '오후' : '오전';
  };

  const get12hTime = (timeStr: string) => {
    if (!timeStr) return '12:00';
    let [h, m] = timeStr.split(':').map(Number);
    h = h % 12;
    if (h === 0) h = 12;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const to24hTime = (time12h: string, ampm: string) => {
    let [h, m] = time12h.split(':').map(Number);
    if (ampm === '오후' && h < 12) h += 12;
    if (ampm === '오전' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const calendarEndDate = endOfWeek(monthEnd);

  const calendarDays = eachDayOfInterval({ start: startDate, end: calendarEndDate });

  const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));

  const handleWheel = (e: React.WheelEvent) => {
    const now = Date.now();
    // 500ms 간격으로 스로틀링 적용
    if (now - lastWheelTime.current < 500) return;

    if (Math.abs(e.deltaY) < 10) return; // 미세한 움직임 무시

    if (e.deltaY > 0) {
      handleNextMonth();
      lastWheelTime.current = now;
    } else if (e.deltaY < 0) {
      handlePrevMonth();
      lastWheelTime.current = now;
    }
  };

  // Double click to add
  const handleDayDoubleClick = (day: Date) => {
    setSelectedDate(day);
    openAddModal(day);
  };

  const openAddModal = (initialDate?: Date) => {
    setIsEditing(false);
    setEditId(null);
    setEditingEvent(null);
    setTitle('');
    const initialDateValue = initialDate ? format(initialDate, 'yyyy-MM-dd') : (selectedDate ? format(selectedDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
    setDate(initialDateValue);
    setEndDate(initialDateValue);
    setStartTime('');
    setEndTime('');
    setIsAllDay(false);
    setShowStartHourPicker(false);
    setShowStartMinPicker(false);
    setShowEndHourPicker(false);
    setShowEndMinPicker(false);
    setDescription('');
    setType(tags?.[0]?.id || 'tag_1');
    setShowModal(true);
  };

  const openEditModal = (event: CalendarEvent) => {
    setIsEditing(true);
    setEditId(event.id);
    setEditingEvent(event);
    setTitle(event.title);
    setDate(event.date);
    setEndDate(event.endDate || event.date);
    setStartTime(event.startTime || '');
    setEndTime(event.endTime || '');
    setIsAllDay(event.isAllDay || false);
    setShowStartHourPicker(false);
    setShowStartMinPicker(false);
    setShowEndHourPicker(false);
    setShowEndMinPicker(false);
    setDescription(event.description || '');
    setType(event.type);
    setShowModal(true);
  };

  const handleSave = () => {
    if (!title.trim() || !date) return;
    const resolvedEndDate = endDate || date;

    if (resolvedEndDate < date) {
      alert('종료일은 시작일보다 빠를 수 없습니다.');
      return;
    }

    if (!isAllDay && startTime && endTime && resolvedEndDate === date && endTime < startTime) {
      alert('같은 날 일정이면 종료 시간은 시작 시간보다 늦어야 합니다.');
      return;
    }

    const eventData: CalendarEvent = {
      id: isEditing && editId ? editId : crypto.randomUUID(),
      title,
      date,
      endDate: resolvedEndDate,
      startTime: !isAllDay ? (startTime || undefined) : undefined,
      endTime: !isAllDay ? (endTime || undefined) : undefined,
      isAllDay,
      description: description || undefined,
      type,
    };

    if (isEditing && editingEvent) {
      onUpdateEvent(eventData, editingEvent);
    } else {
      onAddEvent(eventData);
    }

    setShowModal(false);
  };

  const handleDelete = () => {
    if (isEditing && editId) {
      onDeleteEvent(editId);
      setShowModal(false);
    }
  };



  // Tag helpers
  const getTag = (tagId: string) => tags?.find(t => t.id === tagId);

  try {
    return (
      <div className="flex h-full bg-white text-[#37352f] overflow-hidden font-sans">

        {/* Main Calendar Area */}
        <div
          className="flex-1 flex flex-col h-full border-r border-[#e9e9e8]"
          onWheel={handleWheel}
        >
          {/* Helper Header */}
          <div className="min-h-16 flex items-center justify-between px-4 sm:px-8 border-b border-[#e9e9e8] bg-white">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-medium tracking-normal tabular-nums">
                {format(currentDate, 'yyyy년 M월', { locale: ko })}
              </h1>
              <div className="flex items-center gap-1">
                <button onClick={handlePrevMonth} className="p-1 hover:bg-[#efefef] rounded transition-colors text-[#9b9a97]">
                  <ChevronLeft size={18} />
                </button>
                <button onClick={handleNextMonth} className="p-1 hover:bg-[#efefef] rounded transition-colors text-[#9b9a97]">
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </div>

          {/* Grid Header */}
          <div className="grid grid-cols-7 border-b border-[#e9e9e8]">
            {['일', '월', '화', '수', '목', '금', '토'].map(day => (
              <div key={day} className={`py-2 px-3 text-sm font-medium bg-white ${day === '일' ? 'text-[#eb5757]' : 'text-[#acaba9]'}`}>
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Cells */}
          <div className="flex-1 flex flex-col h-full min-h-0 divide-y divide-[#e9e9e8]">
            {(() => {
              const weeks = [];
              for (let i = 0; i < calendarDays.length; i += 7) {
                weeks.push(calendarDays.slice(i, i + 7));
              }

              return weeks.map((week, weekIdx) => (
                <div key={weekIdx} className="flex-1 grid grid-cols-7 min-h-0 divide-x divide-[#e9e9e8]">
                  {week.map((day) => {
                    const dayEvents = (events || []).filter(e => {
                      try {
                        if (!e.date) return false;
                        const eventStart = parseISO(e.date);
                        const eventEnd = parseISO(e.endDate || e.date);
                        const dayTime = day.getTime();
                        return eventStart.getTime() <= dayTime && eventEnd.getTime() >= dayTime;
                      } catch (e) {
                        console.error("Error parsing event date:", e);
                        return false;
                      }
                    });
                    const isSelected = selectedDate && isSameDay(day, selectedDate);
                    const isCurrentMonth = isSameMonth(day, currentDate);
                    const isToday = dfIsToday(day);

                    return (
                      <div
                        key={day.toISOString()}
                        onClick={() => {
                          setSelectedDate(day);
                          openAddModal(day);
                        }}
                        className={`
                        group relative p-1 select-none transition-colors flex flex-col min-h-0
                        ${!isCurrentMonth ? 'bg-[#fbfbfa]/50 text-[#d3d1cb]' : 'bg-white hover:bg-[#f7f7f5]'}
                        ${isSelected ? 'calendar-cell-selected' : ''}
                      `}
                      >
                        {/* Date Number & Add Button */}
                        <div className="flex justify-between items-center px-1 mb-1 min-h-[24px]">
                          <span className={`
                    text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full
                    ${isToday ? 'bg-[var(--color-primary)] text-white' : ''}
                  `}>
                            {format(day, 'd')}
                          </span>

                          {/* Hover Add Button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openAddModal(day);
                            }}
                            className={`
                      w-5 h-5 flex items-center justify-center rounded hover:bg-[#e0e0e0] text-[#9b9a97] hover:text-[#37352f]
                      opacity-0 group-hover:opacity-100 transition-all
                      ${isSelected ? 'opacity-100' : ''}
                    `}
                          >
                            <Plus size={14} />
                          </button>
                        </div>

                        {/* Event Bars */}
                        <div className="flex flex-col gap-0.5">
                          {dayEvents.slice(0, 4).map(ev => {
                            const tag = getTag(ev.type);
                            const hideTimeForAutoTodoEvent = Boolean(ev.description?.includes('[TODO_LINK:'));
                            return (
                              <div
                                key={ev.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditModal(ev);
                                }}
                                style={{
                                  '--calendar-tag-color': tag?.color || '#37352f',
                                  '--calendar-tag-dark-color': getDarkAdaptiveColor(tag?.color || '#37352f'),
                                } as React.CSSProperties}
                                className={`
                                calendar-event-bar text-xs px-2 py-1 rounded-[4px] truncate cursor-pointer font-medium text-white
                                opacity-90 hover:opacity-100 hover:ring-1 hover:ring-inset hover:ring-[#d3d1cb] leading-tight
                              `}
                              >
                                {!ev.isAllDay && !hideTimeForAutoTodoEvent && ev.startTime && isSameDay(parseISO(ev.date), day) && <span className="mr-1.5 opacity-80 font-normal text-xs">{ev.startTime}</span>}
                                {ev.title}
                              </div>
                            );
                          })}
                          {dayEvents.length > 4 && (
                            <div className="text-xs text-[#9b9a97] px-1.5 font-medium">
                              +{dayEvents.length - 4} 더보기
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ));
            })()}
          </div>
        </div>



        {/* Modern Modal Overlay */}
        {showModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[3px] p-4 transition-all animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-white w-full max-w-[480px] rounded-2xl overflow-hidden text-[#37352f] flex flex-col max-h-[90vh]">
              {/* Modal Header */}
              <div className="px-6 py-4 flex items-center justify-between border-b border-[#f1f1f0]">
                <h3 className="text-[15px] font-medium text-[#787774]">
                  {isEditing ? '일정 수정' : '새 일정'}
                </h3>
                <div className="flex items-center gap-1.5">
                  {isEditing && (
                    <button
                      onClick={handleDelete}
                      className="p-2 text-[#eb5757] hover:bg-[#ffefef] rounded-lg transition-colors"
                      title="삭제"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                  <button
                    onClick={() => setShowModal(false)}
                    className="p-2 text-[#9b9a97] hover:text-[#37352f] hover:bg-[#f1f1f0] rounded-lg transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                <div className="space-y-6">
                  {/* Title Input */}
                  <div className="relative group">
                    <input
                      type="text"
                      placeholder="무엇을 하나요?"
                      className="w-full text-xl font-medium placeholder-[#d3d1cb] border-none focus:ring-0 p-0 text-[#37352f] bg-transparent selection:bg-black/10"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      autoFocus
                    />
                    <div className="h-px w-full bg-[#f1f1f0] mt-2 group-focus-within:bg-[#d4d4d4] transition-colors" />
                  </div>

                  {/* Properties Table-like Layout */}
                  <div className="space-y-4">
                    {/* Date */}
                    <div className="flex items-center group">
                      <div className="w-28 flex items-center gap-2.5 text-[#787774] text-[14px] font-medium shrink-0">
                        <CalendarIcon size={16} className="text-[#9b9a97]" /> 시작일
                      </div>
                      <div className="flex-1 min-h-[36px] flex items-center">
                        <input
                          type="date"
                          className="w-fit bg-transparent border-none focus:ring-0 p-1.5 -ml-1.5 text-[#37352f] text-[14px] cursor-pointer hover:bg-[#f1f1f0] rounded-lg transition-colors font-medium"
                          value={date}
                          onChange={(e) => setDate(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="flex items-center group">
                      <div className="w-28 flex items-center gap-2.5 text-[#787774] text-[14px] font-medium shrink-0">
                        <CalendarIcon size={16} className="text-[#9b9a97]" /> 종료일
                      </div>
                      <div className="flex-1 min-h-[36px] flex items-center">
                        <input
                          type="date"
                          className="w-fit bg-transparent border-none focus:ring-0 p-1.5 -ml-1.5 text-[#37352f] text-[14px] cursor-pointer hover:bg-[#f1f1f0] rounded-lg transition-colors font-medium"
                          value={endDate}
                          min={date}
                          onChange={(e) => setEndDate(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* All Day Toggle */}
                    <div className="flex items-center">
                      <div className="w-28 flex items-center gap-2.5 text-[#787774] text-[14px] font-medium shrink-0">
                        <Clock size={16} className="text-[#9b9a97]" /> 시간 설정
                      </div>
                      <div className="flex-1 flex items-center justify-between">
                        <span className="text-[14px] text-[#37352f] font-medium">
                          {isAllDay ? '하루 종일' : '직접 지정'}
                        </span>
                        <button
                          onClick={() => setIsAllDay(!isAllDay)}
                          className={`
                            relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-200 focus:outline-none
                            ${isAllDay ? 'bg-[#b8b8b8]' : 'bg-[#e2e2e2]'}
                          `}
                        >
                          <span
                            className={`
                              inline-block h-4.5 w-4.5 transform rounded-full bg-white transition-all duration-200
                              ${isAllDay ? 'translate-x-5.5' : 'translate-x-[3px]'}
                            `}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Time Selector (Conditional) */}
                    {!isAllDay && (
                      <div className="flex flex-col gap-3 animate-[fadeIn_0.2s_ease-out]">
                        <div className="flex items-center">
                          <div className="w-28 flex items-center gap-2.5 text-[#787774] text-[14px] font-medium shrink-0">
                            <div className="w-4" /> 시작 시간
                          </div>
                          <div className="flex-1 flex items-center gap-2 relative">
                            <div className="flex items-center bg-[#f1f1f0] rounded-lg p-0.5 border border-[#e2e2e2] relative z-[70]">
                              <button
                                onClick={() => {
                                  const current = getAmPm(startTime);
                                  setStartTime(to24hTime(get12hTime(startTime), current === '오전' ? '오후' : '오전'));
                                }}
                                className="px-2 py-1 text-xs font-medium text-[#37352f] hover:bg-white rounded-md transition-all"
                              >
                                {getAmPm(startTime)}
                              </button>

                              <div className="w-px h-3 bg-[#d3d1cb] mx-0.5" />

                              <div className="relative">
                                <button
                                  onClick={() => setShowStartHourPicker(!showStartHourPicker)}
                                  className="px-2 py-1 text-[14px] font-medium text-[#37352f] hover:bg-white rounded-md transition-all"
                                >
                                  {get12hTime(startTime).split(':')[0]}시
                                </button>
                                {showStartHourPicker && (
                                  <div className="absolute top-full left-0 mt-2 w-20 max-h-48 overflow-y-auto bg-white border border-[#f1f1f0] rounded-xl z-[80] p-1 custom-scrollbar">
                                    {hourOptions.map(h => (
                                      <button
                                        key={`sh-${h}`}
                                        onClick={() => {
                                          const [, m] = get12hTime(startTime).split(':');
                                          setStartTime(to24hTime(`${String(h).padStart(2, '0')}:${m}`, getAmPm(startTime)));
                                          setShowStartHourPicker(false);
                                        }}
                                        className="w-full px-3 py-2 text-center text-[13px] hover:bg-[#f7f7f5] rounded-lg transition-colors font-medium"
                                      >
                                        {h}시
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="relative">
                                <button
                                  onClick={() => setShowStartMinPicker(!showStartMinPicker)}
                                  className="px-2 py-1 text-[14px] font-medium text-[#37352f] hover:bg-white rounded-md transition-all"
                                >
                                  {startTime ? startTime.split(':')[1] : '00'}분
                                </button>
                                {showStartMinPicker && (
                                  <div className="absolute top-full left-0 mt-2 w-20 max-h-48 overflow-y-auto bg-white border border-[#f1f1f0] rounded-xl z-[80] p-1 custom-scrollbar">
                                    {minuteOptions.map(m => (
                                      <button
                                        key={`sm-${m}`}
                                        onClick={() => {
                                          const h12 = get12hTime(startTime).split(':')[0];
                                          setStartTime(to24hTime(`${h12}:${m}`, getAmPm(startTime)));
                                          setShowStartMinPicker(false);
                                        }}
                                        className="w-full px-3 py-2 text-center text-[13px] hover:bg-[#f7f7f5] rounded-lg transition-colors font-medium"
                                      >
                                        {m}분
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* End Time Container */}
                        <div className="flex items-center">
                          <div className="w-28 flex items-center gap-2.5 text-[#787774] text-[14px] font-medium shrink-0">
                            <div className="w-4" /> 종료 시간
                          </div>
                          <div className="flex-1 flex items-center gap-2 relative">
                            <div className="flex items-center bg-[#f1f1f0] rounded-lg p-0.5 border border-[#e2e2e2] relative z-[60]">
                              <button
                                onClick={() => {
                                  const current = getAmPm(endTime);
                                  setEndTime(to24hTime(get12hTime(endTime), current === '오전' ? '오후' : '오전'));
                                }}
                                className="px-2 py-1 text-xs font-medium text-[#37352f] hover:bg-white rounded-md transition-all"
                              >
                                {getAmPm(endTime)}
                              </button>

                              <div className="w-px h-3 bg-[#d3d1cb] mx-0.5" />

                              <div className="relative">
                                <button
                                  onClick={() => setShowEndHourPicker(!showEndHourPicker)}
                                  className="px-2 py-1 text-[14px] font-medium text-[#37352f] hover:bg-white rounded-md transition-all"
                                >
                                  {get12hTime(endTime).split(':')[0]}시
                                </button>
                                {showEndHourPicker && (
                                  <div className="absolute top-full left-0 mt-2 w-20 max-h-48 overflow-y-auto bg-white border border-[#f1f1f0] rounded-xl z-[70] p-1 custom-scrollbar">
                                    {hourOptions.map(h => (
                                      <button
                                        key={`eh-${h}`}
                                        onClick={() => {
                                          const [, m] = get12hTime(endTime).split(':');
                                          setEndTime(to24hTime(`${String(h).padStart(2, '0')}:${m}`, getAmPm(endTime)));
                                          setShowEndHourPicker(false);
                                        }}
                                        className="w-full px-3 py-2 text-center text-[13px] hover:bg-[#f7f7f5] rounded-lg transition-colors font-medium"
                                      >
                                        {h}시
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="relative">
                                <button
                                  onClick={() => setShowEndMinPicker(!showEndMinPicker)}
                                  className="px-2 py-1 text-[14px] font-medium text-[#37352f] hover:bg-white rounded-md transition-all"
                                >
                                  {endTime ? endTime.split(':')[1] : '00'}분
                                </button>
                                {showEndMinPicker && (
                                  <div className="absolute top-full left-0 mt-2 w-20 max-h-48 overflow-y-auto bg-white border border-[#f1f1f0] rounded-xl z-[70] p-1 custom-scrollbar">
                                    {minuteOptions.map(m => (
                                      <button
                                        key={`em-${m}`}
                                        onClick={() => {
                                          const h12 = get12hTime(endTime).split(':')[0];
                                          setEndTime(to24hTime(`${h12}:${m}`, getAmPm(endTime)));
                                          setShowEndMinPicker(false);
                                        }}
                                        className="w-full px-3 py-2 text-center text-[13px] hover:bg-[#f7f7f5] rounded-lg transition-colors font-medium"
                                      >
                                        {m}분
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Tags */}
                    <div className="flex items-start">
                      <div className="w-28 flex items-center gap-2.5 text-[#787774] text-[14px] font-medium shrink-0 pt-1.5">
                        <Check size={16} className="text-[#9b9a97]" /> 태그
                      </div>
                      <div className="flex-1 flex gap-2 flex-wrap">
                        {tags.map(t => (
                          <button
                            key={t.id}
                            onClick={() => setType(t.id)}
                            className={`
                              px-3 py-1.5 rounded-xl text-[13px] font-medium transition-all flex items-center gap-2 border
                              ${type === t.id
                                ? 'bg-[#f3f3f3] text-[#171717] border-[#d4d4d4] scale-105'
                                : 'bg-white text-[#787774] border-[#f1f1f0] hover:bg-[#f7f7f5]'}
                            `}
                          >
                            <div
                              className="calendar-tag-dot w-2.5 h-2.5 rounded-full"
                              style={{
                                '--calendar-tag-color': t.color,
                                '--calendar-tag-dark-color': getDarkAdaptiveColor(t.color),
                              } as React.CSSProperties}
                            />
                            {t.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Memo */}
                    <div className="flex flex-col gap-3 pt-2">
                      <div className="flex items-center gap-2.5 text-[#787774] text-[14px] font-medium">
                        <AlignLeft size={16} className="text-[#9b9a97]" /> 메모
                      </div>
                      <textarea
                        placeholder="메모를 입력하세요..."
                        rows={5}
                        className="w-full bg-[#f7f7f5] border border-[#f1f1f0] rounded-2xl p-4 text-[14px] text-[#37352f] focus:bg-white focus:ring-2 focus:ring-[#d4d4d4]/40 focus:border-[#d4d4d4] transition-all resize-none outline-none leading-relaxed placeholder-[#b1b0ad]"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 bg-[#fbfbfa] border-t border-[#f1f1f0] flex justify-end">
                <button
                  onClick={handleSave}
                  className="bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white px-8 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 shadow-sm shadow-blue-100"
                >
                  일정 저장
                </button>
              </div>
            </div>

            {/* Global backdrop for time pickers */}
            {(showStartHourPicker || showStartMinPicker || showEndHourPicker || showEndMinPicker) && (
              <div
                className="fixed inset-0 z-[65] opacity-0"
                onClick={() => {
                  setShowStartHourPicker(false);
                  setShowStartMinPicker(false);
                  setShowEndHourPicker(false);
                  setShowEndMinPicker(false);
                }}
              />
            )}
          </div>
        )
        }
      </div >
    );
  } catch (error) {
    console.error("CalendarView render error:", error);
    return (
      <div className="p-8 text-center bg-white h-full flex flex-col items-center justify-center">
        <h2 className="text-xl font-medium text-[#eb5757] mb-2">캘린더를 불러오는 중 오류가 발생했습니다.</h2>
        <p className="text-[#787774]">데이터 형식이 올바르지 않거나 로직 오류가 있을 수 있습니다.</p>
        <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-[#f7f7f7] text-[#171717] border border-[#e9e9e8] rounded-lg hover:bg-[#eeeeee]">페이지 새로고침</button>
      </div>
    );
  }
};

export default CalendarView;
