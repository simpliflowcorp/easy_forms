"use client";

import OauthButton from "@/components/buttons/OauthButton";
import PrimaryActionButton from "@/components/buttons/PrimaryActionButton";
import PrimaryButton from "@/components/buttons/PrimaryButton";
import ErroTextCnt from "@/components/Inputs/components/ErrorTextCnt";
import EmailInput from "@/components/Inputs/EmailInput";
import PasswordInput from "@/components/Inputs/PasswordInput";
import TextFieldInput from "@/components/Inputs/TextFieldInput";
import AuthPoster from "@/components/posters/AuthPoster";
import { errorHandler } from "@/helper/errorHandler";
import { useLanguageStore } from "@/store/store";
import axios from "axios";
import { signIn, useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import toast from "react-hot-toast";

export interface ISignInProps {}

export default function SignIn(props: ISignInProps) {
  const router = useRouter();
  const [data, setData] = React.useState({
    email: "",
    password: "",
  });
  const [dataIsValid, setDataIsValid] = React.useState({
    email: false,
    password: false,
  });
  const [resetBtn, setResetBtn] = React.useState(0);
  const lang = useLanguageStore((state) => state.language);
  const session = useSession();

  console.log(session);

  const SignIn = async () => {
    console.log({ dataIsValid });

    if (dataIsValid.email && dataIsValid.password) {
      try {
        const res = await axios.post("/api/auth/signin", data);
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
  const authSignIn = (auth: string) => {
    signIn(auth);
  };

  return (
    <div className="auth-wrapper">
      <div className="img-cnt">
        <AuthPoster />
      </div>
      <div className="cred-form">
        <h1>{lang.sign_in}</h1>
        <div className="inputs-wrapper">
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
            <Link className="link" href="/auth/forgotPassword">
              {lang.forgot_password}
            </Link>
          </div>

          <div className="link-cnt">
            <span>{lang.dont_have_an_account}</span>

            <Link className="link" href="/auth/signup">
              {lang.sign_up}
            </Link>
          </div>

          <PrimaryActionButton
            label="sign_in"
            action={SignIn}
            resetBtn={resetBtn}
          />
          <OauthButton
            label="sign_in_with_google"
            action={authSignIn}
            auth={"google"}
          />
        </div>
      </div>
    </div>
  );
}
