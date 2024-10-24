import Image from "next/image";
import * as React from "react";

export interface IAuthPosterProps {}

export default function AuthPoster(props: IAuthPosterProps) {
  return (
    <div className="auth-poster">
      <div className="logo">
        <Image
          src="/logos/logo_name_dark_trans_2000.png"
          alt="logo"
          width={228}
          height={60}
          className="logo-img"
          priority
        />
        <div className="product">
          <span className="hash">#</span>
          <span>Easy Form</span>
        </div>
      </div>
      <div className="quote">
        <h2>Craft forms,</h2>
        <h3>capture data,</h3>
        <h1>spark your ideas!</h1>
      </div>
    </div>
  );
}
