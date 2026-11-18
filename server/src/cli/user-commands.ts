import { parseArgs } from 'node:util';
import { USER_ROLES, type UserRole } from '../db/schema.js';
import { userService, type PublicUser } from '../auth/user-service.js';
import { promptNewPassword } from './prompt-password.js';
import { shareService } from '../access/share-service.js';

export const USER_USAGE = [
  'user create --email <e> --name <n> --role owner|friend   create an account (asks the password)',
  'user password --email <e>                                  set a new password (asks it; signs out everywhere)',
  'user disable --email <e> | user enable --email <e>         block or allow an account',
  'user list                                                  list accounts',
];

function requireUser(email: string | undefined) {
  if (!email) throw new Error('--email is required.');
  const user = userService.findByEmail(email);
  if (!user) throw new Error(`No account with ${email}.`);
  return user;
}

function printUsers(users: PublicUser[]): void {
  if (users.length === 0) {
    console.log('No accounts yet. Create the owner first: pnpm user create --email … --name … --role owner');
    return;
  }
  for (const u of users) {
    console.log(`${String(u.id).padStart(3)}  ${u.role.padEnd(6)}  ${u.email}  (${u.displayName})${u.disabled ? '  DISABLED' : ''}`);
  }
}

export async function runUserCommand(args: string[]): Promise<void> {
  const [action, ...rest] = args;
  const { values } = parseArgs({
    args: rest,
    options: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } },
    strict: true,
  });
  switch (action) {
    case 'create': {
      if (!values.email || !values.name || !values.role) throw new Error('create needs --email, --name and --role.');
      if (!USER_ROLES.includes(values.role as UserRole)) throw new Error(`--role must be one of ${USER_ROLES.join(', ')}.`);
      const password = await promptNewPassword();
      const user = await userService.create({ email: values.email, displayName: values.name, password, role: values.role as UserRole });
      if (user.role === 'friend') shareService.shareAllWith(user.id);
      console.log(`Created ${user.role} ${user.email}${user.role === 'friend' ? ' (opens every source; change it on People and access)' : ''}.`);
      return;
    }
    case 'password': {
      const user = requireUser(values.email);
      await userService.setPassword(user.id, await promptNewPassword());
      console.log(`Password changed for ${user.email}; their sessions were ended.`);
      return;
    }
    case 'disable':
    case 'enable': {
      const user = userService.setDisabled(requireUser(values.email).id, action === 'disable');
      console.log(`${user.email} is ${user.disabled ? 'disabled; their sessions were ended' : 'enabled'}.`);
      return;
    }
    case 'list':
      printUsers(userService.list());
      return;
    default:
      throw new Error(`Usage:\n  ${USER_USAGE.join('\n  ')}`);
  }
}
