"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export type SignInState = { error: string } | undefined;

export async function signInWithCredentials(
  _prev: SignInState,
  formData: FormData
): Promise<SignInState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/",
    });
    return undefined; // unreachable — signIn redirects on success
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Invalid email or password." };
    }
    throw error; // NEXT_REDIRECT must propagate
  }
}

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/" });
}
