using FluentAssertions;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.UnitTests.Domain;

public class UniversityTests
{
    [Fact]
    public void Create_ShouldInitializeWithDefaults()
    {
        var uni = University.Create("Mekong International University", "MIU", "did:jwk:123");

        uni.Id.Should().NotBeEmpty();
        uni.Name.Should().Be("Mekong International University");
        uni.Code.Should().Be("MIU");
        uni.IssuerId.Should().Be("did:jwk:123");
        uni.Status.Should().Be(UniversityStatus.ACTIVE);
        uni.IsActive().Should().BeTrue();
    }

    [Theory]
    [InlineData("", "MIU", "did:jwk:123")]
    [InlineData("Name", "", "did:jwk:123")]
    [InlineData("Name", "MIU", "")]
    public void Create_ShouldThrowArgumentException_WhenInvalidArgs(string name, string code, string issuerId)
    {
        var act = () => University.Create(name, code, issuerId);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Deactivate_ShouldSetStatusToInactive()
    {
        var uni = University.Create("Name", "CODE", "did:jwk:123");
        uni.Deactivate();

        uni.Status.Should().Be(UniversityStatus.INACTIVE);
        uni.IsActive().Should().BeFalse();
    }

    [Fact]
    public void Activate_ShouldSetStatusToActive()
    {
        var uni = University.Create("Name", "CODE", "did:jwk:123", status: UniversityStatus.INACTIVE);
        uni.Activate();

        uni.Status.Should().Be(UniversityStatus.ACTIVE);
        uni.IsActive().Should().BeTrue();
    }

    [Fact]
    public void UpdateDetails_ShouldUpdateFields()
    {
        var uni = University.Create("Old Name", "OLD", "did:old");
        uni.UpdateDetails("New Name", "NEW", "did:new");

        uni.Name.Should().Be("New Name");
        uni.Code.Should().Be("NEW");
        uni.IssuerId.Should().Be("did:new");
    }
}
