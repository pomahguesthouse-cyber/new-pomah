import { defineMcp } from "@lovable.dev/mcp-js";
import listRoomTypesTool from "./tools/list-room-types";
import checkAvailabilityTool from "./tools/check-availability";

export default defineMcp({
  name: "pomah-guesthouse-mcp",
  title: "Pomah Guesthouse",
  version: "0.1.0",
  instructions:
    "Public tools for Pomah Guesthouse. Use `list_room_types` to browse rooms and `check_availability` to check availability for a date range.",
  tools: [listRoomTypesTool, checkAvailabilityTool],
});
