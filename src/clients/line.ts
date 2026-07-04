import { messagingApi } from "@line/bot-sdk";

import type { BotProfileConfig, LineReplyClient, LineReplyOptions } from "../types.js";

export function createLineSdkReplyClient(profile: BotProfileConfig): LineReplyClient {
  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: profile.channelAccessToken
  });

  return {
    async replyText(replyToken: string, text: string, options?: LineReplyOptions): Promise<void> {
      await client.replyMessage({
        replyToken,
        messages: [
          {
            type: "text",
            text,
            ...(options?.quickReplies?.length
              ? {
                  quickReply: {
                    items: options.quickReplies.map((item) => ({
                      type: "action",
                      action: item.action
                    }))
                  }
                }
              : {})
          }
        ]
      });
    }
  };
}
