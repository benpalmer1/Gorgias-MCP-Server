export interface ProjectedTicket {
  id: number;
  subject: string | null;
  excerpt: string | null;
  status: string;
  priority: string;
  channel: string | null;
  customerEmail: string | null;
  customerName: string | null;
  assigneeName: string | null;
  assigneeTeam: string | null;
  tags: string[];
  messagesCount: number;
  createdAt: string | null;
  lastMessageAt: string | null;
  closedAt: string | null;
}

export interface ProjectedMessage {
  id: number;
  fromAgent: boolean;
  isInternalNote: boolean;
  senderName: string | null;
  senderEmail: string | null;
  text: string | null;
  channel: string | null;
  createdAt: string | null;
  intents: string[];
}

export function projectTicket(
  ticket: any,
  actualMessageCount?: number,
): ProjectedTicket {
  const customer = ticket.customer ?? null;
  const assigneeUser = ticket.assignee_user ?? null;
  const assigneeTeam = ticket.assignee_team ?? null;
  const tags: any[] = ticket.tags ?? [];

  return {
    id: ticket.id,
    subject: ticket.subject ?? null,
    excerpt: ticket.excerpt ?? null,
    status: ticket.status,
    priority: ticket.priority,
    channel: ticket.channel ?? null,
    customerEmail: customer?.email ?? null,
    customerName: customer?.name ?? null,
    assigneeName: assigneeUser?.name ?? null,
    assigneeTeam: assigneeTeam?.name ?? null,
    tags: tags.flatMap((t: any) => (t?.name != null ? [t.name] : [])),
    messagesCount: actualMessageCount ?? ticket.messages_count ?? 0,
    createdAt: ticket.created_datetime ?? null,
    lastMessageAt: ticket.last_message_datetime ?? null,
    closedAt: ticket.closed_datetime ?? null,
  };
}

export function projectMessage(message: any): ProjectedMessage {
  const sender = message.sender ?? null;
  const intents: any[] | null | undefined = message.intents;

  return {
    id: message.id,
    fromAgent: message.from_agent ?? false,
    isInternalNote: message.public === false,
    senderName: sender?.name ?? null,
    senderEmail: sender?.email ?? null,
    text: message.stripped_text ?? message.body_text ?? null,
    channel: message.channel ?? null,
    createdAt: message.created_datetime ?? null,
    intents: Array.isArray(intents) ? intents.flatMap((i: any) => (i?.name != null ? [i.name] : [])) : [],
  };
}

export function sortMessagesChronologically(messages: any[]): any[] {
  return [...messages].sort((a, b) => {
    const dateA = a.created_datetime ? new Date(a.created_datetime).getTime() : Infinity;
    const dateB = b.created_datetime ? new Date(b.created_datetime).getTime() : Infinity;
    return dateA - dateB;
  });
}
