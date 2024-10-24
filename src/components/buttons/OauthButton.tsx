"use client";

import { useLanguageStore } from "@/store/store";
import Image from "next/image";
import * as React from "react";

export interface IOauthButtonProps {
  label: string;
  auth: string;
  action: (auth: string) => void;
}

export default function OauthButton(props: IOauthButtonProps) {
  const [isClicked, setIsClicked] = React.useState(false);
  const lang = useLanguageStore((state) => state.language);

  React.useEffect(() => {
    if (isClicked) {
      setTimeout(() => {
        setIsClicked(false);
      }, 2000);
    }
  }, [isClicked]);
  return (
    <div
      className={isClicked ? "oauth-button inactive" : "oauth-button"}
      onClick={() => props.action(props.auth)}
    >
      <Image
        src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg"
        alt="logo"
        width={16}
        height={16}
      />
      <span>{lang[props.label]}</span>
    </div>
  );
}
