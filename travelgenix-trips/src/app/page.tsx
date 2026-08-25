import { redirect } from 'next/navigation';

// The root is the console. Marketing lives on the Travelgenix site, not here.
export default function Home() {
  redirect('/console');
}
