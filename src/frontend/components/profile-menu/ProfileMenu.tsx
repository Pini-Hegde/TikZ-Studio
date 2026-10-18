import { useEffect, useState } from "react";
import { HomeIcon, LogOut, UserRound } from "lucide-react";
import "./ProfileMenu.css";

type Props = {
  email: string | null;
  onHome: () => void;
  onLogout: () => void;
};

export default function ProfileMenu({ email, onHome, onLogout }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(".profile-menu-wrap")) {
        return;
      }

      setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className="profile-menu-wrap">
      {isOpen && (
        <div className="profile-menu" role="menu" aria-label="Profile menu">
          <button
            className="profile-menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onHome();
            }}
          >
            <HomeIcon size={17} />
            <span>Home</span>
          </button>
          <button
            className="profile-menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onLogout();
            }}
          >
            <LogOut size={17} />
            <span>Logout</span>
          </button>
        </div>
      )}

      <button
        className="profile-button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <UserRound size={18} />
        <span className="profile-email">{email}</span>
      </button>
    </div>
  );
}
