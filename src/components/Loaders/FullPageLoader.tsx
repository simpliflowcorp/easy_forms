"use client";
import React from "react";

type Props = {};

const FullPageLoader = (props: Props) => {
  return (
    <div className="body-wrapper theme-dark">
      <div className="loader-cnt">
        <div className="loader-blob-4-dot"></div>
      </div>
    </div>
  );
};

export default FullPageLoader;
