import { Outlet } from "react-router";
import { RoleProvider } from "./RoleContext";
import { CurrencyProvider } from "./CurrencyContext";
import { AuthProvider } from "./AuthContext";

export function RootWrapper() {
  return (
    <AuthProvider>
      <RoleProvider>
        <CurrencyProvider>
          <Outlet />
        </CurrencyProvider>
      </RoleProvider>
    </AuthProvider>
  );
}
