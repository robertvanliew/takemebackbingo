import { createBrowserRouter } from "react-router-dom";
import { Layout } from "./layout/Layout";
import { Home } from "./pages/Home";
import { Stub } from "./pages/Stub";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: "play", element: <Stub title="How to Play" /> },
      { path: "events", element: <Stub title="Events" /> },
      { path: "gallery", element: <Stub title="Gallery" /> },
      { path: "legal", element: <Stub title="Legal" /> },
    ],
  },
]);
