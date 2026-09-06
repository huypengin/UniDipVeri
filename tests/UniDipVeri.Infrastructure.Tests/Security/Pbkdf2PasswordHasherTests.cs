using FluentAssertions;
using UniDipVeri.Infrastructure.Security;
using Xunit.Abstractions;

namespace UniDipVeri.Infrastructure.Tests.Security;

public class Pbkdf2PasswordHasherTests(ITestOutputHelper output)
{
    [Fact]
    public void HashPassword_ShouldGenerateVerifiableHash()
    {
        var hasher = new Pbkdf2PasswordHasher();
        var password = "Password123!";

        var hash = hasher.HashPassword(password);
        output.WriteLine($"Generated hash: {hash}");

        hasher.VerifyPassword(password, hash).Should().BeTrue();
        hasher.VerifyPassword("WrongPassword", hash).Should().BeFalse();
    }
}
