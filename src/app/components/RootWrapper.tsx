import { Outlet } from "react-router";
import { RoleProvider } from "./RoleContext";

export function RootWrapper() {
  return (
    <RoleProvider>
      <Outlet />
    </RoleProvider>
  );
}
