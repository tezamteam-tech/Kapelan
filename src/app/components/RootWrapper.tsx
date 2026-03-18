import { Outlet } from "react-router";
import { RoleProvider } from "./RoleContext";
import { CurrencyProvider } from "./CurrencyContext";

export function RootWrapper() {
  return (
    <RoleProvider>
      <CurrencyProvider>
        <Outlet />
      </CurrencyProvider>
    </RoleProvider>
  );
}
