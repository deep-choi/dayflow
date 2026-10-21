import React, { useEffect, useRef, useState } from 'react';
import { User } from '../types';
import { SettingsTab } from '../views/SettingsView';
import { User as UserIcon, Database, Settings, LogOut, ShieldCheck } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { isAdminMetadata } from '../utils/adminPolicy';

interface UserMenuPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  onOpenTab: (tab: SettingsTab, hideTabs?: boolean) => void;
  onOpenFullSettings: () => void;
  onLogout: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  isSidebarCollapsed?: boolean;
  positionClassName?: string;
}

export const UserMenuPopover: React.FC<UserMenuPopoverProps> = ({
  isOpen,
  onClose,
  currentUser,
  onOpenTab,
  onOpenFullSettings,
  onLogout,
  triggerRef,
  isSidebarCollapsed = false,
  positionClassName,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setIsAdmin(false);
    if (isOpen && currentUser?.id) void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled && data.user?.id === currentUser.id) setIsAdmin(isAdminMetadata(data.user.app_metadata));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isOpen, currentUser?.id]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        (!triggerRef?.current || !triggerRef.current.contains(target))
      ) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen) return null;

  const positionClasses = positionClassName ?? (isSidebarCollapsed
    ? 'left-full bottom-0 ml-2.5 w-56'
    : 'left-3 right-3 sm:left-4 sm:right-4 bottom-full mb-2 w-auto max-w-full');

  return (
    <div
      ref={popoverRef}
      className={`absolute ${positionClasses} bg-white rounded-2xl border border-[#e9e9e8] shadow-xl shadow-black/10 py-1.5 z-[70] font-sans text-left transition-opacity duration-150 ease-out opacity-100`}
    >
      {/* Main Settings Item */}
      <div className="px-1 space-y-0.5">
        <button
          type="button"
          onClick={() => {
            onOpenFullSettings();
            onClose();
          }}
          className="w-full px-3 py-2.5 flex items-center gap-3 rounded-xl text-[14px] leading-5 font-medium text-[#37352f] hover:bg-[#f7f7f7] transition-colors text-left"
        >
          <Settings size={18} className="text-[#37352f] shrink-0" />
          <span>설정</span>
        </button>
      </div>

      <div className="my-1 border-b border-[#e9e9e8]" />
      {isAdmin && <a href="/admin" className="mx-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] text-[#37352f] hover:bg-[#f7f7f7]"><ShieldCheck size={18} />관리자 페이지</a>}

      {/* Logout */}
      <div className="px-1">
        <button
          type="button"
          onClick={() => {
            onLogout();
            onClose();
          }}
          className="w-full px-3 py-2.5 flex items-center gap-3 rounded-xl text-[14px] leading-5 font-medium text-[#37352f] hover:bg-[#f7f7f7] transition-colors text-left"
        >
          <LogOut size={18} className="text-[#37352f] shrink-0" />
          <span>로그아웃</span>
        </button>
      </div>
    </div>
  );
};
