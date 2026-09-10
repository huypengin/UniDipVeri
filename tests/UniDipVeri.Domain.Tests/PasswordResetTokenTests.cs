using FluentAssertions;
using UniDipVeri.Domain.Entities;

namespace UniDipVeri.Domain.Tests;

public class PasswordResetTokenTests
{
    [Fact]
    public void Create_ShouldInitializePropertiesCorrectly()
    {
        var email = "student@test.edu";
        var userType = "student";
        var tokenHash = "hash123456789";
        var lifetime = TimeSpan.FromMinutes(15);

        var token = PasswordResetToken.Create(email, userType, tokenHash, lifetime);

        token.Id.Should().NotBeEmpty();
        token.Email.Should().Be("student@test.edu");
        token.UserType.Should().Be("student");
        token.TokenHash.Should().Be("hash123456789");
        token.ExpiresAt.Should().BeAfter(DateTime.UtcNow.AddMinutes(14));
        token.UsedAt.Should().BeNull();
        token.IsValid().Should().BeTrue();
    }

    [Theory]
    [InlineData("", "student", "hash123")]
    [InlineData("test@test.edu", "", "hash123")]
    [InlineData("test@test.edu", "student", "")]
    [InlineData("test@test.edu", "invalid_type", "hash123")]
    public void Create_ShouldThrowArgumentException_WhenInvalidArgs(string email, string userType, string tokenHash)
    {
        var act = () => PasswordResetToken.Create(email, userType, tokenHash, TimeSpan.FromMinutes(15));
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Create_ShouldThrowArgumentException_WhenLifetimeZeroOrNegative()
    {
        var act = () => PasswordResetToken.Create("test@test.edu", "staff", "hash123", TimeSpan.Zero);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void IsValid_ShouldReturnFalse_WhenExpired()
    {
        var token = PasswordResetToken.Create("test@test.edu", "staff", "hash123", TimeSpan.FromMinutes(15));

        token.IsValid(DateTime.UtcNow.AddMinutes(16)).Should().BeFalse();
    }

    [Fact]
    public void MarkAsUsed_ShouldSetUsedAtAndInvalidateToken()
    {
        var token = PasswordResetToken.Create("test@test.edu", "staff", "hash123", TimeSpan.FromMinutes(15));

        token.MarkAsUsed();

        token.UsedAt.Should().NotBeNull();
        token.IsValid().Should().BeFalse();
    }

    [Fact]
    public void MarkAsUsed_ShouldThrow_WhenAlreadyUsed()
    {
        var token = PasswordResetToken.Create("test@test.edu", "staff", "hash123", TimeSpan.FromMinutes(15));
        token.MarkAsUsed();

        var act = () => token.MarkAsUsed();
        act.Should().Throw<InvalidOperationException>();
    }
}
