// hooks/useActivityDetection.ts
import { useEffect } from "react";

const useActivityDetector = (callback: () => void, timeout = 30000) => {
  useEffect(() => {
    let activityTimer: NodeJS.Timeout;

    const resetTimer = () => {
      clearTimeout(activityTimer);
      callback();
      activityTimer = setTimeout(() => {
        // Consider inactive after timeout
      }, timeout);
    };

    const events = ["mousemove", "keydown", "scroll", "click"];
    events.forEach((event) => window.addEventListener(event, resetTimer));

    return () => {
      events.forEach((event) => window.removeEventListener(event, resetTimer));
      clearTimeout(activityTimer);
    };
  }, [callback, timeout]);
};

export default useActivityDetector;
