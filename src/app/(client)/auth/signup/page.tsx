"use client";

import OauthButton from "@/components/buttons/OauthButton";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import ErroTextCnt from "@/components/Inputs/components/ErrorTextCnt";
import EmailInput from "@/components/Inputs/EmailInput";
import AuthPoster from "@/components/posters/AuthPoster";
import PasswordInput from "@/components/Inputs/PasswordInput";
import TextFieldInput from "@/components/Inputs/TextFieldInput";
import { errorHandler } from "@/helper/errorHandler";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { signIn, useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import toast from "react-hot-toast";

export interface IsignUpProps {}

export default function SignUp(props: IsignUpProps) {
  const router = useRouter();
  const [data, setData] = React.useState({
    username: "",
    email: "",
    password: "",
  });
  const [dataIsValid, setDataIsValid] = React.useState({
    username: false,
    email: false,
    password: false,
  });
  const [resetBtn, setResetBtn] = React.useState(0);
  const [hasNotification, setHasNotification] = React.useState(true);
  const lang = useLanguageStore((state) => state.language);

  const signUp = async () => {
    if (dataIsValid.username && dataIsValid.email && dataIsValid.password) {
      try {
        const res = await axios.post("/api/auth/signup", data);
        if (res.status === 200) {
          router.push("/profile");
        }
      } catch (error: any) {
        setResetBtn((p) => p + 1);
        errorHandler(error, lang);
      }
    } else {
      setResetBtn((p) => p + 1);
    }
  };
  const authSignUp = (auth: string) => {
    signIn(auth);
  };

  const dbtest = async () => {
    const res = await axios.get("/api/testDb");
  };
  React.useEffect(() => {
    dbtest();
  }, []);

  // React.useEffect(() => {
  //   const changeFavicon = (src) => {
  //     const link = document.querySelector("link[rel~='icon']");
  //     if (!link) {
  //       const newLink = document.createElement("link");
  //       newLink.rel = "icon";
  //       newLink.href = src;
  //       document.head.appendChild(newLink);
  //     } else {
  //       link.href = src;
  //     }
  //   };

  //   if (hasNotification) {
  //     changeFavicon("/favicon_not.png");
  //   } else {
  //     changeFavicon("/favicon.ico");
  //   }
  // }, [hasNotification]);

  return (
    <div className="auth-wrapper">
      <div className="img-cnt">
        <AuthPoster />
      </div>
      <div className="cred-form">
        <h1>{lang.sign_up}</h1>
        <div className="inputs-wrapper">
          <TextFieldInput
            reset={resetBtn}
            label={lang.username}
            value={data.username}
            updateValue={(value) => setData({ ...data, username: value })}
            isRequired={true}
            isValid={dataIsValid.username}
            updateIsValid={(value) =>
              setDataIsValid((p) => ({ ...p, username: value }))
            }
          />

          <EmailInput
            reset={resetBtn}
            value={data.email}
            label={lang.email}
            updateValue={(value) => setData((p) => ({ ...p, email: value }))}
            isRequired={true}
            isValid={dataIsValid.email}
            updateIsValid={(value) =>
              setDataIsValid((p) => ({ ...p, email: value }))
            }
          />

          <PasswordInput
            reset={resetBtn}
            label={lang.password}
            value={data.password}
            updateValue={(value) => setData({ ...data, password: value })}
            isRequired={true}
            isValid={dataIsValid.password}
            updateIsValid={(value) =>
              setDataIsValid((p) => ({ ...p, password: value }))
            }
          />

          <div className="link-cnt">
            <span>{lang.already_have_an_account}</span>

            <Link className="link" href="/auth/signin">
              {lang.sign_in}
            </Link>
          </div>

          <PrimaryActionButton
            label="sign_up"
            action={signUp}
            resetBtn={resetBtn}
          />
          <OauthButton
            label="sign_up_with_google"
            action={authSignUp}
            auth={"google"}
          />
        </div>
      </div>
    </div>
  );
}
