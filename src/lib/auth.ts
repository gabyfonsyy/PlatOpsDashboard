import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";

const isDev = process.env.NODE_ENV === "development";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    // Dev-only bypass — never active in production
    ...(isDev
      ? [
          CredentialsProvider({
            id: "dev-bypass",
            name: "Dev Bypass",
            credentials: {},
            async authorize() {
              return {
                id: "dev-user",
                name: "Dev User",
                email: "dev@sprout.ph",
                image: null,
              };
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // Dev bypass always allowed
      if (account?.provider === "dev-bypass") return true;

      // Reject an address Google itself says is unverified. Deliberately `=== false` rather than
      // falsy: a provider that simply omits the claim must not be turned away, so this can only
      // ever reject an explicit "no", never an absent yes.
      if ((profile as { email_verified?: boolean } | undefined)?.email_verified === false) {
        return false;
      }

      // Lower-cased before the check: the domain is the whole authorisation decision here, and an
      // address that arrives capitalised is the same account. Note this is an exact "@sprout.ph"
      // suffix, so a lookalike domain (evil-sprout.ph) does not satisfy it.
      const email = (user.email ?? "").toLowerCase();
      return email.endsWith("@sprout.ph");
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        (session.user as { id?: string }).id = token.sub;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
};
