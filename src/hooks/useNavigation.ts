import { useState, useCallback, useEffect } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";
import { Section } from "@/types/navigation";
import { STORE_KEYS } from "@/lib/constants";

const store = new LazyStore("settings.json");

export function useNavigation() {
  const [activeSection, setActiveSection] = useState<Section>("general");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadState() {
      try {
        const collapsed = await store.get<boolean>(STORE_KEYS.SIDEBAR_COLLAPSED);
        setIsCollapsed(collapsed ?? false);
      } catch (err) {
        console.error("Failed to load sidebar state:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadState();
  }, []);

  const toggleCollapsed = useCallback(async () => {
    const newValue = !isCollapsed;
    setIsCollapsed(newValue);
    try {
      await store.set(STORE_KEYS.SIDEBAR_COLLAPSED, newValue);
    } catch (err) {
      console.error("Failed to save sidebar state:", err);
    }
  }, [isCollapsed]);

  const navigateTo = useCallback((section: Section) => {
    setActiveSection(section);
  }, []);

  return {
    activeSection,
    isCollapsed,
    isLoading,
    navigateTo,
    toggleCollapsed,
  };
}
