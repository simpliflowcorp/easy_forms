"use client";
import Head from "next/head";
import React from "react";

const FaviconWrapper = ({ children }: { children: React.ReactNode }) => {
  const [hasNotification, setHasNotification] = React.useState(true);
  const [iconSrc, setIconSrc] = React.useState("/favicon_not.ico");

  React.useEffect(() => {
    if (hasNotification) {
      setIconSrc("/favicon_not.ico");
    } else {
      setIconSrc("/favicon.ico");
    }
  }, [hasNotification]);

  return (
    <>
      <Head>
        <link rel="icon" href={iconSrc} />
      </Head>
      {children}
    </>
  );
};

export default FaviconWrapper;
