import { messagingApi } from "@line/bot-sdk";

import type {
  BotProfileConfig,
  LineIdentityClient,
  LineReplyClient,
  LineReplyOptions
} from "../types.js";

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

export function createLineSdkIdentityClient(profile: BotProfileConfig): LineIdentityClient {
  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: profile.channelAccessToken
  });

  return {
    async getUserDisplayName(userId: string): Promise<string | undefined> {
      const profile = await client.getProfile(userId);
      return nonBlank(profile.displayName);
    },

    async getGroupDisplayName(groupId: string): Promise<string | undefined> {
      const summary = await client.getGroupSummary(groupId);
      return nonBlank(summary.groupName);
    }
  };
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
