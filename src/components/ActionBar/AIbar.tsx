"use client";
import { useLanguageStore } from "@/store/store";
import { useSession } from "next-auth/react";
import React from "react";
import toast from "react-hot-toast";

type Props = {};

const AIbar = (props: Props) => {
  // This component is a simple AI interaction bar with an input field and a face icon.
  // It can be extended to include more functionality like sending messages or displaying AI responses.

  const lang = useLanguageStore((state) => state.language);
  const [user, setUser] = React.useState({} as any);
  const [gotData, setGotData] = React.useState(false);
  const [chat, setChat] = React.useState([
    { role: "assistant", content: "Hi! Describe the form you want to build." },
  ]);

  const session = useSession();

  const [prompt, setPrompt] = React.useState("");
  const [conversationHistory, setConversationHistory] = React.useState<any[]>(
    []
  );
  const [isLoading, setIsLoading] = React.useState(false);

  const handleAIChat = async (message: string) => {
    if (!prompt.trim()) return;
    const updatedChat = [...chat, { role: "user", content: message }];
    setChat(updatedChat);
    setPrompt("");
    const res = await fetch("/api/chat-form", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    setIsLoading(false);
    talkBack(data.reply);
    setChat([...updatedChat, { role: "assistant", content: data.reply }]);
  };

  React.useEffect(() => {
    setTimeout(() => {
      setIsLoading(false);
    }, 2000); // Simulate loading delay
  }, [isLoading]);

  const talkBack = (message: string) => {
    toast.dismiss(); // Dismiss any previous toast
    toast((t) => <span onClick={() => toast.dismiss(t.id)}>{message}</span>, {
      position: "bottom-right",
      duration: Infinity,
      style: {
        background: "#333",
        color: "#fff",
        padding: "10px 20px",
        marginBottom: "50px",
        borderRadius: "8px",
        fontSize: "16px",
      },
    });
  };

  return (
    <div className="ai-bar">
      <div className="ai-input-section">
        <input
          disabled={isLoading}
          onKeyDown={(e) => {
            if (e.key === "Enter" && prompt.trim() !== "") {
              handleAIChat(prompt);
              setIsLoading(true);
              talkBack("Processing your request...");
            }
          }}
          className="ai-input"
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>
      {isLoading ? (
        <div className="ai-face">
          <div className="eye eye_left loading"></div>
          <div className="eye eye_right loading"></div>
        </div>
      ) : (
        <div
          onClick={() => {
            handleAIChat(prompt);
            setIsLoading(true);
            talkBack("Processing your request...");
          }}
          className="ai-face"
        >
          <div className="eye eye_left"></div>
          <div className="eye eye_right"></div>
        </div>
      )}
    </div>
  );
};

export default AIbar;
